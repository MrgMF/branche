import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const post = (a: FastifyInstance, payload: Record<string, unknown>, ip = '198.51.100.7') =>
  a.inject({ method: 'POST', url: '/v1/checkins', payload, remoteAddress: ip });
const community = (a: FastifyInstance, id: string) => a.inject(`/v1/stations/${encodeURIComponent(id)}/community`);

describe('POST /v1/checkins', () => {
  it('201 puis visible dans /community (taux de réussite, prix, pré-autorisation), dates au jour près', async () => {
    const m = await makeApp();
    app = m.app;
    const r = await post(app, { stationId: 'FRTSTP0001', ok: true, pricePaid: 12.345, kWh: 25, preauth: 50 });
    expect(r.statusCode).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({ id: expect.stringMatching(/^ck-[0-9a-f-]{36}$/), duplicate: false });
    await post(app, { stationId: 'FRTSTP0001', ok: false }, '198.51.100.8');
    m.clock.advance(3600_000);
    await post(app, { stationId: 'FRTSTP0001', ok: true, pricePaid: 8, preauth: 30 }, '198.51.100.9');
    const c = await community(app, 'FRTSTP0001');
    expect(c.statusCode).toBe(200);
    expect(c.headers['cache-control']).toBe('public, max-age=60');
    expect(c.json()).toEqual({
      stationId: 'FRTSTP0001',
      windowDays: 30,
      checkins: 3,
      okCount: 2,
      successRate: 0.67,
      lastOkAt: '2026-11-05',
      lastFailAt: '2026-11-05',
      recentPrices: [
        { pricePaid: 8, kWh: null, pricePerKwh: null, date: '2026-11-05' },
        { pricePaid: 12.35, kWh: 25, pricePerKwh: 0.49, date: '2026-11-05' },
      ],
      preauth: { median: 40, count: 2, lastDate: '2026-11-05' },
    });
  });

  it('aucune IP ni empreinte dans la réponse publique', async () => {
    ({ app } = await makeApp());
    await post(app, { stationId: 'FRS1', ok: true }, '203.0.113.42');
    const body = (await community(app, 'FRS1')).body;
    expect(body).not.toContain('203.0.113');
    expect(body).not.toMatch(/fingerprint|reporter|ip/i);
  });

  it('anti-doublon : même appareil + même station dans les 6 h → 200 duplicate, non compté ; autre station acceptée', async () => {
    const m = await makeApp();
    app = m.app;
    const a = await post(app, { stationId: 'FRS1', ok: true });
    const b = await post(app, { stationId: 'FRS1', ok: false });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ id: a.json().id, duplicate: true });
    expect((await post(app, { stationId: 'FRS2', ok: true })).statusCode).toBe(201);
    expect((await community(app, 'FRS1')).json().checkins).toBe(1);
    m.clock.advance(6 * 3600_000 + 1);
    expect((await post(app, { stationId: 'FRS1', ok: false })).statusCode).toBe(201);
    expect((await community(app, 'FRS1')).json().checkins).toBe(2);
  });

  it('limite 10 par heure et par IP → 429 rate_limited', async () => {
    ({ app } = await makeApp());
    for (let i = 0; i < 10; i++) expect((await post(app, { stationId: `FRS${i}00`, ok: true })).statusCode).toBe(201);
    const r = await post(app, { stationId: 'FRS999', ok: true });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('rate_limited');
    expect((await post(app, { stationId: 'FRS999', ok: true }, '198.51.100.99')).statusCode).toBe(201);
  });

  it.each([
    [{ ok: true }],
    [{ stationId: 'FRS1' }],
    [{ stationId: 'FRS1', ok: 'oui' }],
    [{ stationId: 'FRS1', ok: true, pricePaid: -1 }],
    [{ stationId: 'FRS1', ok: true, pricePaid: 9999 }],
    [{ stationId: 'FRS1', ok: true, kWh: 1000 }],
    [{ stationId: 'FRS1', ok: true, carte: '4242' }],
    [{ stationId: 'x', ok: true }],
  ])('400 invalid_body %j', async (payload) => {
    ({ app } = await makeApp());
    const r = await post(app, payload);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_body');
  });

  it('400 invalid_station pour un identifiant avec caractère de contrôle', async () => {
    ({ app } = await makeApp());
    const r = await post(app, { stationId: 'FR\u0001S1', ok: true });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_station');
  });
});

describe('GET /v1/stations/:id/community', () => {
  it('station sans retour : 200 avec valeurs nulles', async () => {
    ({ app } = await makeApp());
    expect((await community(app, 'FRINCONNUE')).json()).toEqual({
      stationId: 'FRINCONNUE',
      windowDays: 30,
      checkins: 0,
      okCount: 0,
      successRate: null,
      lastOkAt: null,
      lastFailAt: null,
      recentPrices: [],
      preauth: null,
    });
  });

  it('taux sur 30 jours ; prix gardés 90 jours puis oubliés ; 5 prix maximum', async () => {
    const m = await makeApp();
    app = m.app;
    for (let i = 0; i < 7; i++) await post(app, { stationId: 'FRS1', ok: i > 0, pricePaid: 10 + i }, `198.51.100.${i + 1}`);
    let c = (await community(app, 'FRS1')).json();
    expect(c.recentPrices.map((p: { pricePaid: number }) => p.pricePaid)).toEqual([16, 15, 14, 13, 12]);
    m.clock.advance(31 * 86_400_000);
    c = (await community(app, 'FRS1')).json();
    expect(c.checkins).toBe(0);
    expect(c.successRate).toBeNull();
    expect(c.lastOkAt).toBe('2026-11-05');
    expect(c.recentPrices).toHaveLength(5);
    m.clock.advance(60 * 86_400_000);
    c = (await community(app, 'FRS1')).json();
    expect(c.recentPrices).toEqual([]);
    expect(c.lastOkAt).toBeNull();
  });

  it('identifiants de repli du pipeline (virgule, barre, espaces) acceptés', async () => {
    ({ app } = await makeApp());
    const id = '48.7585,2.3035|Borne de la mairie';
    expect((await post(app, { stationId: id, ok: true })).statusCode).toBe(201);
    expect((await community(app, id)).json().checkins).toBe(1);
  });
});
