import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createSession, makeApp, RETURN_URL } from './helpers.js';
import { computeCost } from '../src/sessions/service.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

describe('santé et configuration', () => {
  it('GET /health renvoie le mode démo', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, mode: 'demo', payment: 'mock', charger: 'simulator' });
  });

  it('GET /v1/config renvoie les tarifs', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/v1/config');
    expect(res.json()).toEqual({ priceCentsPerKwh: 45, feeCents: 49, preauthCents: 5000, currency: 'eur', demo: true });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const cors = await app.inject({ url: '/v1/config', headers: { origin: 'https://x.github.io' } });
    expect(cors.headers['access-control-allow-origin']).toBe('https://x.github.io');
  });

  it('route inconnue → 404 JSON en français', async () => {
    ({ app } = await makeApp());
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Ressource introuvable.' } });
  });
});

describe('création de session', () => {
  it('crée une session (201) avec id aléatoire et checkoutUrl mock', async () => {
    ({ app } = await makeApp());
    const res = await createSession(app);
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s.id).toMatch(/^ses_[0-9a-f-]{36}$/);
    expect(s).toMatchObject({
      status: 'awaiting_payment',
      stationId: 'FRS01E0001',
      stationName: 'Parking Mairie',
      pdcId: 'FRS01E0001-1',
      demo: true,
      priceCentsPerKwh: 45,
      feeCents: 49,
      preauthCents: 5000,
      energyWh: 0,
      powerKw: 0,
      costCents: 0,
      totalCents: 0,
      startedAt: null,
      endedAt: null,
      error: null,
    });
    expect(s.checkoutUrl).toBe(`http://api.test/mock-checkout/${s.id}`);
    expect(new Date(s.createdAt).toISOString()).toBe(s.createdAt);
    expect(s).not.toHaveProperty('returnUrl');
    const other = (await createSession(app)).json();
    expect(other.id).not.toBe(s.id);
  });

  it.each([
    'https://evil.com/x',
    'http://localhost.evil.com/',
    'http://localhost:80@evil.com/',
    'https://github.io.evil.com/',
    'https://a.b.github.io/',
    'javascript:alert(1)',
    '//evil.com',
    'https://user.github.io\\@evil.com',
  ])('refuse la returnUrl %s (400)', async (returnUrl) => {
    ({ app } = await makeApp());
    const res = await createSession(app, { returnUrl });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_return_url');
  });

  it.each(['branche://session', 'exp://192.168.1.2:8081/--/session', 'http://localhost:8081/session', 'https://monorg.github.io/branche/session'])(
    'accepte la returnUrl %s',
    async (returnUrl) => {
      ({ app } = await makeApp());
      expect((await createSession(app, { returnUrl })).statusCode).toBe(201);
    },
  );

  it('valide le corps (champ manquant, champ inconnu, type)', async () => {
    ({ app } = await makeApp());
    const missing = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { stationId: 'A', returnUrl: RETURN_URL } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('invalid_body');
    expect((await createSession(app, { extra: 1 })).statusCode).toBe(400);
    expect((await createSession(app, { stationId: 42 })).statusCode).toBe(400);
    expect((await createSession(app, { stationName: 'x'.repeat(500) })).statusCode).toBe(400);
  });
});

describe('parcours mock', () => {
  it('create → page → authorize → charging → énergie croissante → stop → completed', async () => {
    let clock;
    ({ app, clock } = await makeApp());
    const s = (await createSession(app)).json();

    const page = await app.inject(`/mock-checkout/${s.id}`);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('Mode démo — aucun débit réel');
    expect(page.body).toContain('Autoriser 50,00');
    expect(page.body).toContain('Parking Mairie');
    expect(page.body).toContain('lang="fr"');

    const auth = await app.inject({ method: 'POST', url: `/mock-checkout/${s.id}/authorize` });
    expect(auth.statusCode).toBe(303);
    expect(auth.headers.location).toBe(`${RETURN_URL}?session=${s.id}`);

    let cur = (await app.inject(`/v1/sessions/${s.id}`)).json();
    expect(cur.status).toBe('charging');
    expect(cur.startedAt).not.toBeNull();
    expect(cur.energyWh).toBe(0);

    clock.advance(10_000); // mi-rampe : 25 kW
    cur = (await app.inject(`/v1/sessions/${s.id}`)).json();
    expect(cur.powerKw).toBe(25);
    const e1 = cur.energyWh;
    expect(e1).toBeGreaterThan(0);

    clock.advance(50_000); // t = 60 s : 50 kW, 13 888 Wh (× SIM_SPEED 20)
    cur = (await app.inject(`/v1/sessions/${s.id}`)).json();
    expect(cur.powerKw).toBe(50);
    expect(cur.energyWh).toBeGreaterThan(e1);
    expect(cur.energyWh).toBe(13888);

    const stop = await app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/stop` });
    expect(stop.statusCode).toBe(200);
    const done = stop.json();
    const expected = computeCost(13888, 45, 49, 5000);
    expect(done).toMatchObject({ status: 'completed', energyWh: 13888, powerKw: 0, costCents: 625, totalCents: 674 });
    expect(done.totalCents).toBe(expected.totalCents);
    expect(done.endedAt).not.toBeNull();

    // Plus rien n'évolue après l'arrêt, et l'arrêt est idempotent.
    clock.advance(60_000);
    expect((await app.inject(`/v1/sessions/${s.id}`)).json().energyWh).toBe(13888);
    const again = await app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/stop` });
    expect(again.statusCode).toBe(200);
    expect(again.json().totalCents).toBe(674);
  });

  it('arrêt automatique au plafond de pré-autorisation', async () => {
    let clock;
    ({ app, clock } = await makeApp());
    const s = (await createSession(app)).json();
    await app.inject({ method: 'POST', url: `/mock-checkout/${s.id}/authorize` });
    clock.advance(30 * 60_000);
    const cur = (await app.inject(`/v1/sessions/${s.id}`)).json();
    expect(cur.status).toBe('completed');
    expect(cur.totalCents).toBe(5000);
    expect(cur.costCents + cur.feeCents).toBeGreaterThanOrEqual(5000);
    expect(cur.costCents + cur.feeCents).toBeLessThanOrEqual(5001);
    expect(cur.powerKw).toBe(0);
  });

  it('la capture est idempotente (une seule opération par session)', async () => {
    const { MockPaymentProvider } = await import('../src/payments/mock.js');
    const payment = new MockPaymentProvider('http://api.test');
    let clock;
    ({ app, clock } = await makeApp({}, { payment }));
    const s = (await createSession(app)).json();
    await app.inject({ method: 'POST', url: `/mock-checkout/${s.id}/authorize` });
    clock.advance(60_000);
    await Promise.all([
      app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/stop` }),
      app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/stop` }),
    ]);
    const ops = [...payment.operations.values()];
    expect(ops).toEqual([{ type: 'capture', paymentRef: `mock_pi_${s.id}`, amountCents: 674 }]);
  });

  it('lien Annuler de la page → cancelled et redirection', async () => {
    ({ app } = await makeApp());
    const s = (await createSession(app)).json();
    const res = await app.inject({ method: 'POST', url: `/mock-checkout/${s.id}/cancel` });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`${RETURN_URL}?session=${s.id}&cancelled=1`);
    expect((await app.inject(`/v1/sessions/${s.id}`)).json().status).toBe('cancelled');
    // Autoriser après annulation est refusé.
    const auth = await app.inject({ method: 'POST', url: `/mock-checkout/${s.id}/authorize` });
    expect(auth.statusCode).toBe(409);
  });

  it('POST /cancel avant démarrage, puis refus après démarrage', async () => {
    ({ app } = await makeApp());
    const a = (await createSession(app)).json();
    const res = await app.inject({ method: 'POST', url: `/v1/sessions/${a.id}/cancel` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'cancelled', totalCents: 0 });

    const b = (await createSession(app)).json();
    await app.inject({ method: 'POST', url: `/mock-checkout/${b.id}/authorize` });
    const late = await app.inject({ method: 'POST', url: `/v1/sessions/${b.id}/cancel` });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('invalid_state');
  });

  it('stop avant paiement → 409', async () => {
    ({ app } = await makeApp());
    const s = (await createSession(app)).json();
    const res = await app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/stop` });
    expect(res.statusCode).toBe(409);
  });

  it('session inconnue → 404 (API et page)', async () => {
    ({ app } = await makeApp());
    for (const url of ['/v1/sessions/ses_00000000-0000-0000-0000-000000000000', '/v1/sessions/abc']) {
      const res = await app.inject(url);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Session introuvable.' } });
    }
    expect((await app.inject({ method: 'POST', url: '/v1/sessions/abc/stop' })).statusCode).toBe(404);
    expect((await app.inject('/mock-checkout/abc')).statusCode).toBe(404);
  });

  it('échappe le nom de station dans la page HTML', async () => {
    ({ app } = await makeApp());
    const s = (await createSession(app, { stationName: '<script>alert(1)</script>' })).json();
    const page = await app.inject(`/mock-checkout/${s.id}`);
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('rate limit', () => {
  it('limite à 60 requêtes/min/IP', async () => {
    ({ app } = await makeApp());
    for (let i = 0; i < 60; i++) expect((await app.inject('/v1/config')).statusCode).toBe(200);
    const res = await app.inject('/v1/config');
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('rate_limited');
    // /health n'est pas limité (sondes Render).
    expect((await app.inject('/health')).statusCode).toBe(200);
  });
});
