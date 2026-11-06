import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_IRVE_DYN_URL, availabilityEnabled, loadAvailabilityConfig } from '../src/availability/config.js';
import { normalizePdcId, parseHorodatage, parseIrveDynamic, toStatus } from '../src/availability/parse.js';
import { AvailabilityService, FEED_STALE_MS, IDLE_STOP_MS, RETRY_MS } from '../src/availability/service.js';
import { parseIds } from '../src/routes/availability.js';
import { Clock, makeApp } from './helpers.js';

const CSV = readFileSync(fileURLToPath(new URL('./fixtures/irve-dynamique-2.3.1.csv', import.meta.url)), 'utf8');
const HEADER = CSV.split('\n')[0]!;
const MIN = 60_000;

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    return handler(url);
  };
  return { fn, calls };
}
const csv = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/csv' } });

async function* chunks(s: string, size: number) {
  const buf = Buffer.from(s);
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

function service(clock: Clock, fetchFn: (url: string) => Promise<Response>) {
  const timers: { fn: () => void; ms: number }[] = [];
  const svc = new AvailabilityService({
    url: 'https://src.test/irve.csv',
    fetchFn,
    now: clock.now,
    refreshMs: 2 * MIN,
    setInterval: (fn, ms) => {
      const h = { fn, ms };
      timers.push(h);
      return h;
    },
    clearInterval: (h) => void timers.splice(timers.indexOf(h as (typeof timers)[number]), 1),
  });
  return { svc, timers };
}

describe('schéma IRVE dynamique — fixtures', () => {
  it('reprend les en-têtes exacts du schéma etalab/schema-irve-dynamique 2.3.x', () => {
    expect(HEADER).toBe(
      'id_pdc_itinerance,etat_pdc,occupation_pdc,horodatage,etat_prise_type_2,etat_prise_type_combo_ccs,etat_prise_type_chademo,etat_prise_type_ef',
    );
  });
});

describe('normalisation et mapping', () => {
  it('normalise les identifiants (majuscules, sans *)', () => {
    expect(normalizePdcId('fr*abc*e0006*1')).toBe('FRABCE00061');
    expect(normalizePdcId('  FRS01E0001 ')).toBe('FRS01E0001');
    expect(normalizePdcId('X1')).toBeNull();
    expect(normalizePdcId('12ABCDEF')).toBeNull();
    expect(normalizePdcId('FR-S01-E0001')).toBeNull();
    expect(normalizePdcId(`FR${'A'.repeat(34)}`)).toBeNull();
  });

  it('etat_pdc × occupation_pdc → statut', () => {
    expect(toStatus('en_service', 'libre')).toBe('libre');
    expect(toStatus('en_service', 'occupe')).toBe('occupe');
    expect(toStatus('en_service', 'reserve')).toBe('occupe');
    expect(toStatus('hors_service', 'libre')).toBe('hors_service');
    expect(toStatus('hors_service', 'inconnu')).toBe('hors_service');
    expect(toStatus('inconnu', 'libre')).toBe('inconnu');
    expect(toStatus('inconnu', 'occupe')).toBe('occupe');
    expect(toStatus('en_service', 'inconnu')).toBe('inconnu');
    expect(toStatus('EN_SERVICE', ' Libre ')).toBe('libre');
    expect(toStatus('ouvert', 'dispo')).toBe('inconnu');
  });

  it('horodatage : fuseau obligatoire, formats ±hh:mm, ±hhmm, Z', () => {
    expect(parseHorodatage('2026-11-05T12:55:00+01:00')).toBe(Date.UTC(2026, 10, 5, 11, 55));
    expect(parseHorodatage('2026-11-05T12:55:00+0100')).toBe(Date.UTC(2026, 10, 5, 11, 55));
    expect(parseHorodatage('2026-11-05 11:55:00Z')).toBe(Date.UTC(2026, 10, 5, 11, 55));
    expect(parseHorodatage('2026-11-05T12:55:00')).toBeNull();
    expect(parseHorodatage('hier')).toBeNull();
    expect(parseHorodatage('2026-13-45T12:55:00Z')).toBeNull();
  });
});

describe('parseIrveDynamic', () => {
  it('parse la fixture : index, doublons, rejets', async () => {
    const r = await parseIrveDynamic(CSV);
    expect(r.rows).toBe(16);
    expect(r.rejected).toBe(2); // X1 (id invalide) et horodatage sans fuseau
    expect(r.index.size).toBe(12);
    expect(r.index.get('FRS01E0001')?.status).toBe('libre');
    expect(r.index.get('FRS01E0003')?.status).toBe('hors_service');
    expect(r.index.get('FRS01E0004')?.status).toBe('occupe');
    expect(r.index.get('FRABCE00061')?.status).toBe('libre');
    expect(r.index.get('FRS01E0011')?.status).toBe('libre');
    // Doublon : la ligne la plus récente gagne, même si une plus ancienne suit.
    expect(r.index.get('FRS01E0008')).toEqual({ status: 'libre', at: Date.UTC(2026, 10, 5, 11, 58) });
    expect(r.index.has('FRS01E0099')).toBe(false);
    expect(r.latest).toBe(Date.UTC(2026, 10, 5, 13, 30));
  });

  it('flux en morceaux coupés au milieu des lignes, BOM, CRLF', async () => {
    const src = `﻿${CSV.replace(/\n/g, '\r\n')}`;
    const r = await parseIrveDynamic(chunks(src, 37));
    expect(r.index.size).toBe(12);
    expect(r.index.get('FRS01E0002')?.status).toBe('occupe');
  });

  it('colonnes repérées par nom (fichier consolidé avec colonnes supplémentaires, ordre différent)', async () => {
    const s =
      'datagouv_dataset_id,horodatage,occupation_pdc,id_pdc_itinerance,etat_pdc,datagouv_organization_or_owner\n' +
      '6489,2026-11-05T12:55:00+01:00,libre,FRS01E0001,en_service,"Opérateur, SAS"\n';
    const r = await parseIrveDynamic(s);
    expect(r.index.get('FRS01E0001')?.status).toBe('libre');
  });

  it('rejette un fichier sans les en-têtes du schéma (page HTML, mauvais fichier)', async () => {
    await expect(parseIrveDynamic('<html><body>Erreur</body></html>\n')).rejects.toThrow(/en-têtes/);
    await expect(parseIrveDynamic('')).rejects.toThrow(/vide/);
  });

  it('limites de taille et de lignes', async () => {
    await expect(parseIrveDynamic(chunks(CSV, 64), { maxBytes: 200, maxRows: 1e6 })).rejects.toThrow(/volumineux/);
    await expect(parseIrveDynamic(CSV, { maxBytes: 1e9, maxRows: 3 })).rejects.toThrow(/lignes/);
  });

  it('volume réaliste : 100 000 lignes', async () => {
    const lines = [HEADER];
    for (let i = 0; i < 100_000; i++) lines.push(`FRX01E${String(i).padStart(6, '0')},en_service,libre,2026-11-05T12:55:00+01:00,fonctionnel,,,`);
    const t0 = Date.now();
    const r = await parseIrveDynamic(chunks(lines.join('\n'), 64 * 1024));
    expect(r.index.size).toBe(100_000);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('AvailabilityService', () => {
  it('statuts, ancienneté > 30 min et horodatage futur → inconnu, id absent → at null', async () => {
    const clock = new Clock();
    const f = fakeFetch(() => csv(CSV));
    const { svc } = service(clock, f.fn);
    const r = await svc.lookup(['FRS01E0001', 'FRS01E0007', 'FRS01E0012', 'FRS01E0003', 'FRZZZZZZ']);
    expect(r.feedOk).toBe(true);
    expect(r.updatedAt).toBe('2026-11-05T12:00:00.000Z');
    expect(r.items.FRS01E0001).toEqual({ status: 'libre', at: '2026-11-05T11:55:00.000Z' });
    expect(r.items.FRS01E0007).toEqual({ status: 'inconnu', at: '2026-11-05T10:00:00.000Z' });
    expect(r.items.FRS01E0012?.status).toBe('inconnu');
    expect(r.items.FRS01E0003?.status).toBe('hors_service');
    expect(r.items.FRZZZZZZ).toEqual({ status: 'inconnu', at: null });
  });

  it('un statut vieillit vers « inconnu » sans nouveau téléchargement', async () => {
    const clock = new Clock();
    let ok = true;
    const f = fakeFetch(() => (ok ? csv(CSV) : csv('erreur', 503)));
    const { svc } = service(clock, f.fn);
    await svc.lookup(['FRS01E0001']);
    ok = false;
    clock.advance(26 * MIN); // horodatage 11:55 → 12:26 : 31 min
    const r = await svc.lookup(['FRS01E0001']);
    expect(r.items.FRS01E0001?.status).toBe('inconnu');
  });

  it('source en panne : copie périmée servie, feedOk=false au-delà de 15 min', async () => {
    const clock = new Clock();
    let ok = true;
    const warn = vi.fn();
    const f = fakeFetch(() => (ok ? csv(CSV) : csv('erreur', 500)));
    const svc = new AvailabilityService({ url: 'https://src.test/x', fetchFn: f.fn, now: clock.now, refreshMs: 2 * MIN, log: { warn }, setInterval: () => ({}) });
    await svc.lookup(['FRS01E0001']);
    ok = false;
    clock.advance(3 * MIN);
    let r = await svc.lookup(['FRS01E0001']);
    await svc.refresh();
    expect(r.feedOk).toBe(true);
    expect(r.items.FRS01E0001?.status).toBe('libre');
    expect(warn).toHaveBeenCalledWith({ reason: 'flux IRVE dynamique HTTP 500' }, 'flux IRVE dynamique indisponible');
    clock.advance(FEED_STALE_MS);
    r = await svc.lookup(['FRS01E0002']);
    expect(r.feedOk).toBe(false);
    expect(r.updatedAt).toBe('2026-11-05T12:00:00.000Z');
    expect(r.items.FRS01E0002?.at).toBe('2026-11-05T11:55:00.000Z');
  });

  it('source en panne dès le départ : feedOk=false, tout inconnu ; tentatives espacées', async () => {
    const clock = new Clock();
    const f = fakeFetch(() => {
      throw new Error('ECONNRESET');
    });
    const { svc } = service(clock, f.fn);
    const r = await svc.lookup(['FRS01E0001']);
    expect(r).toMatchObject({ feedOk: false, updatedAt: null, items: { FRS01E0001: { status: 'inconnu', at: null } } });
    await svc.lookup(['FRS01E0001']);
    await svc.lookup(['FRS01E0001']);
    expect(f.calls).toHaveLength(1);
    clock.advance(RETRY_MS);
    await svc.lookup(['FRS01E0001']);
    expect(f.calls).toHaveLength(2);
  });

  it('fichier valide mais vide ou corrompu : la copie précédente est conservée', async () => {
    const clock = new Clock();
    let body = CSV;
    const f = fakeFetch(() => csv(body));
    const { svc } = service(clock, f.fn);
    await svc.lookup(['FRS01E0001']);
    body = `${HEADER}\n`;
    await svc.refresh();
    body = '<html>maintenance</html>';
    await svc.refresh();
    expect((await svc.lookup(['FRS01E0001'])).items.FRS01E0001?.status).toBe('libre');
  });

  it('une seule requête amont à la fois, cache pendant la période de rafraîchissement', async () => {
    const clock = new Clock();
    const f = fakeFetch(() => csv(CSV));
    const { svc } = service(clock, f.fn);
    await Promise.all([svc.lookup(['FRS01E0001']), svc.lookup(['FRS01E0002']), svc.lookup(['FRS01E0003'])]);
    expect(f.calls).toHaveLength(1);
    clock.advance(MIN);
    await svc.lookup(['FRS01E0001']);
    expect(f.calls).toHaveLength(1);
    clock.advance(MIN);
    await svc.lookup(['FRS01E0001']); // copie servie sans attendre, rafraîchissement en arrière-plan
    await svc.refresh();
    expect(f.calls).toHaveLength(2);
  });

  it('polling démarré à la première requête, arrêté après 30 min sans requête', async () => {
    const clock = new Clock();
    const f = fakeFetch(() => csv(CSV));
    const { svc, timers } = service(clock, f.fn);
    expect(svc.polling).toBe(false);
    await svc.lookup(['FRS01E0001']);
    expect(svc.polling).toBe(true);
    expect(timers[0]?.ms).toBe(2 * MIN);
    clock.advance(2 * MIN);
    await svc.tick();
    expect(f.calls).toHaveLength(2);
    clock.advance(IDLE_STOP_MS);
    await svc.tick();
    expect(svc.polling).toBe(false);
    expect(timers).toHaveLength(0);
    expect(f.calls).toHaveLength(2);
  });
});

describe('configuration', () => {
  it('URL officielle par défaut, surcharge et désactivation', () => {
    expect(loadAvailabilityConfig({}).url).toBe(DEFAULT_IRVE_DYN_URL);
    expect(DEFAULT_IRVE_DYN_URL).toBe('https://www.data.gouv.fr/api/1/datasets/r/89185b1f-f958-4c5b-9282-399a66ecee97');
    expect(loadAvailabilityConfig({ IRVE_DYN_URL: 'https://miroir.test/irve.csv' }).url).toBe('https://miroir.test/irve.csv');
    expect(loadAvailabilityConfig({ IRVE_DYN_URL: 'off' }).url).toBeNull();
    expect(availabilityEnabled({ IRVE_DYN_URL: 'off' })).toBe(false);
    expect(availabilityEnabled({})).toBe(true);
    expect(() => loadAvailabilityConfig({ IRVE_DYN_URL: 'ftp://x' })).toThrow(/IRVE_DYN_URL/);
    expect(() => loadAvailabilityConfig({ IRVE_DYN_URL: 'https://u:p@x.test/' })).toThrow(/identifiants/);
  });

  it('rafraîchissement entre 2 et 10 min, préchargement en production seulement', () => {
    expect(loadAvailabilityConfig({}).refreshMs).toBe(120_000);
    expect(loadAvailabilityConfig({ IRVE_DYN_REFRESH_S: '300' }).refreshMs).toBe(300_000);
    expect(() => loadAvailabilityConfig({ IRVE_DYN_REFRESH_S: '30' })).toThrow(/IRVE_DYN_REFRESH_S/);
    expect(() => loadAvailabilityConfig({ IRVE_DYN_REFRESH_S: 'x' })).toThrow(/IRVE_DYN_REFRESH_S/);
    expect(loadAvailabilityConfig({}).warmup).toBe(false);
    expect(loadAvailabilityConfig({ NODE_ENV: 'production' }).warmup).toBe(true);
  });
});

describe('validation des ids', () => {
  it('normalise, dédoublonne', () => {
    expect(parseIds('FRS01E0001, fr*s01*e0001,FRS01E0002')).toEqual(['FRS01E0001', 'FRS01E0002']);
  });
  it('rejette absent, vide, trop nombreux, caractères interdits', () => {
    const code = (raw: unknown) => {
      try {
        parseIds(raw);
        return 'ok';
      } catch (e) {
        return (e as { code: string }).code;
      }
    };
    expect(code(undefined)).toBe('invalid_ids');
    expect(code('')).toBe('invalid_ids');
    expect(code(['FRS01E0001', 'FRS01E0002'])).toBe('invalid_ids');
    expect(code('FRS01E0001,,FRS01E0002')).toBe('invalid_ids');
    expect(code('FRS01E0001;FRS01E0002')).toBe('invalid_ids');
    expect(code('FRS01E0001%27')).toBe('invalid_ids');
    expect(code('FR')).toBe('invalid_ids');
    expect(code(Array.from({ length: 200 }, (_, i) => `FRS01E${String(i).padStart(4, '0')}`).join(','))).toBe('ok');
    expect(code(Array.from({ length: 201 }, (_, i) => `FRS01E${String(i).padStart(4, '0')}`).join(','))).toBe('too_many_ids');
  });
});

describe('GET /v1/availability', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    vi.unstubAllEnvs();
    await app?.close();
  });

  it('réponse, source officielle par défaut, cache court', async () => {
    const f = fakeFetch(() => csv(CSV));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    expect(f.calls).toHaveLength(0); // aucun téléchargement avant la première requête (hors production)
    const res = await app.inject({ method: 'GET', url: '/v1/availability?ids=FRS01E0001,fr*abc*e0006*1,FRS01E0003,FRS01E0404' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(f.calls).toEqual([DEFAULT_IRVE_DYN_URL]);
    const body = res.json();
    expect(body).toMatchObject({ updatedAt: '2026-11-05T12:00:00.000Z', feedOk: true });
    expect(body.source).toMatch(/Licence Ouverte 2\.0/);
    expect(body.items).toEqual({
      FRS01E0001: { status: 'libre', at: '2026-11-05T11:55:00.000Z' },
      FRABCE00061: { status: 'libre', at: '2026-11-05T11:57:00.000Z' },
      FRS01E0003: { status: 'hors_service', at: '2026-11-05T11:50:00.000Z' },
      FRS01E0404: { status: 'inconnu', at: null },
    });
  });

  it('IRVE_DYN_URL surcharge la source', async () => {
    vi.stubEnv('IRVE_DYN_URL', 'https://miroir.test/irve.csv');
    const f = fakeFetch(() => csv(CSV));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    await app.inject({ method: 'GET', url: '/v1/availability?ids=FRS01E0001' });
    expect(f.calls).toEqual(['https://miroir.test/irve.csv']);
  });

  it('validation stricte → 400', async () => {
    const f = fakeFetch(() => csv(CSV));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const get = (q: string) => app.inject({ method: 'GET', url: `/v1/availability${q}` });
    const many = Array.from({ length: 201 }, (_, i) => `FRS01E${String(i).padStart(4, '0')}`).join(',');
    for (const [q, code] of [
      ['', 'invalid_ids'],
      ['?ids=', 'invalid_ids'],
      ['?ids=FRS01E0001&ids=FRS01E0002', 'invalid_ids'],
      ['?ids=FRS01E0001,%3Cscript%3E', 'invalid_ids'],
      [`?ids=${many}`, 'too_many_ids'],
      ['?ids=FRS01E0001&lat=48.85', 'invalid_query'],
    ] as const) {
      const res = await get(q);
      expect(res.statusCode, q.slice(0, 40)).toBe(400);
      expect(res.json().error.code).toBe(code);
      expect(res.body).not.toContain('script');
    }
    expect(f.calls).toHaveLength(0);
  });

  it('source en panne : 200, feedOk=false, statuts inconnus', async () => {
    const f = fakeFetch(() => csv('Service Unavailable', 503));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const res = await app.inject({ method: 'GET', url: '/v1/availability?ids=FRS01E0001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ feedOk: false, updatedAt: null, items: { FRS01E0001: { status: 'inconnu', at: null } } });
  });

  it('journaux sans identifiants de points de charge', async () => {
    const lines: string[] = [];
    const f = fakeFetch(() => csv('x', 500));
    ({ app } = await makeApp({}, { fetch: f.fn, logger: { level: 'info', stream: { write: (m: string) => void lines.push(m) } } }));
    await app.inject({ method: 'GET', url: '/v1/availability?ids=FRSECRET0001,FRSECRET0002' });
    await app.inject({ method: 'GET', url: '/v1/availability?ids=FRSECRET0003,%3C' });
    expect(lines.join('\n')).toContain('flux IRVE dynamique indisponible');
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  it('IRVE_DYN_URL=off : 503 et features.availability=false dans /v1/meta', async () => {
    vi.stubEnv('IRVE_DYN_URL', 'off');
    const f = fakeFetch(() => csv(CSV));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const res = await app.inject({ method: 'GET', url: '/v1/availability?ids=FRS01E0001' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('availability_disabled');
    expect((await app.inject({ method: 'GET', url: '/v1/meta' })).json().features.availability).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it('/v1/meta annonce features.availability=true par défaut', async () => {
    ({ app } = await makeApp({}, { fetch: fakeFetch(() => csv(CSV)).fn }));
    const meta = (await app.inject({ method: 'GET', url: '/v1/meta' })).json();
    expect(meta.features.availability).toBe(true);
  });

  it('les signalements borne_hs (/v1/reports) restent inchangés', async () => {
    ({ app } = await makeApp({}, { fetch: fakeFetch(() => csv(CSV)).fn }));
    const res = await app.inject({ method: 'POST', url: '/v1/reports', payload: { type: 'borne_hs', lon: 2.35, lat: 48.85 } });
    expect(res.statusCode).toBe(201);
  });
});
