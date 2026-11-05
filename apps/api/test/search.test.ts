import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { parsePhoton, parseTomTomSearch } from '../src/search/service.js';
import { makeApp } from './helpers.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const TT = fixture('tomtom-search.json');
const PHOTON = fixture('photon-search.json');
const KEY = 'tt-secret-KEY-123';

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    return handler(url);
  };
  return { fn, calls };
}
const json = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });
let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});
const post = (a: FastifyInstance, payload: Record<string, unknown>, ip = '203.0.113.9') =>
  a.inject({ method: 'POST', url: '/v1/search', payload, remoteAddress: ip });

describe('POST /v1/search — TomTom (clé présente)', () => {
  it('fuzzy search FR + DROM, fr-FR, biais de position, résultats normalisés, no-store', async () => {
    const f = fakeFetch(() => json(TT));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const res = await post(app, { q: '10 rue de rivoli paris', near: { lat: 48.85661, lon: 2.35222 } });
    expect(res.statusCode).toBe(200);
    const url = new URL(f.calls[0]!);
    expect(url.pathname).toBe('/search/2/search/10%20rue%20de%20rivoli%20paris.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: KEY,
      countrySet: 'FR,GP,MQ,GF,RE,YT',
      language: 'fr-FR',
      limit: '8',
      typeahead: 'true',
      lat: '48.857',
      lon: '2.352',
    });
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.provider).toBe('tomtom');
    expect(body.attribution).toBe('© TomTom');
    expect(body.results).toEqual([
      { label: '10 Rue de Rivoli', sublabel: '75004 Paris', lat: 48.85564, lon: 2.35896, kind: 'address' },
      { label: 'Rue de Rivoli', sublabel: '75001 Paris', lat: 48.86209, lon: 2.33656, kind: 'street' },
      { label: 'Musée du Louvre', sublabel: 'Rue de Rivoli, 75001 Paris', lat: 48.86061, lon: 2.33764, kind: 'poi' },
      { label: 'Rivolet', sublabel: 'Auvergne-Rhône-Alpes', lat: 46.0028, lon: 4.5793, kind: 'city' },
    ]);
    expect(res.body).not.toContain(KEY);
  });

  it('jamais de cache : deux recherches identiques → deux appels', async () => {
    const f = fakeFetch(() => json(TT));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    await post(app, { q: 'rivoli' });
    await post(app, { q: 'rivoli' });
    expect(f.calls).toHaveLength(2);
  });

  it('fournisseur en panne → 502 sans la clé ni la requête', async () => {
    const f = fakeFetch(() => json(`{"error":"bad key ${KEY}"}`, 403));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const res = await post(app, { q: 'rue secrète' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('search_provider_error');
    expect(res.body).not.toContain(KEY);
    expect(res.body).not.toContain('secrète');
  });
});

describe('POST /v1/search — repli Photon (sans clé)', () => {
  it('photon.komoot.io, lang=fr, bbox France métropolitaine, attribution OSM', async () => {
    const f = fakeFetch(() => json(PHOTON));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const res = await post(app, { q: 'rivoli' });
    expect(res.statusCode).toBe(200);
    const url = new URL(f.calls[0]!);
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('lang')).toBe('fr');
    expect(url.searchParams.get('bbox')).toBe('-6,41,10,51.6');
    expect(url.searchParams.get('lat')).toBeNull();
    const body = res.json();
    expect(body).toMatchObject({ provider: 'photon', attribution: '© contributeurs OpenStreetMap, Photon (komoot)' });
    expect(body.results).toEqual([
      { label: '10 Rue de Rivoli', sublabel: '75004 Paris', lat: 48.85566, lon: 2.3589, kind: 'address' },
      { label: 'Rue de Rivoli', sublabel: '75001 Paris', lat: 48.86209, lon: 2.33656, kind: 'street' },
      { label: 'Musée du Louvre', sublabel: 'Rue de Rivoli, 75001 Paris', lat: 48.8606, lon: 2.3376, kind: 'poi' },
      { label: 'Antony', sublabel: '92160 Île-de-France', lat: 48.8, lon: 2.29, kind: 'city' },
    ]);
  });

  it('position dans un DROM → bbox du territoire et biais', async () => {
    const f = fakeFetch(() => json('{"type":"FeatureCollection","features":[]}'));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    await post(app, { q: 'pointe', near: { lat: 16.2411, lon: -61.5331 } });
    const url = new URL(f.calls[0]!);
    expect(url.searchParams.get('bbox')).toBe('-63.5,14,-60.5,18.5');
    expect(url.searchParams.get('lat')).toBe('16.241');
  });

  it('PHOTON_URL=off sans clé → 503 search_unavailable', async () => {
    ({ app } = await makeApp({ PHOTON_URL: 'off' }, { fetch: fakeFetch(() => json('{}')).fn }));
    const res = await post(app, { q: 'rivoli' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('search_unavailable');
    expect(() => loadConfig({ PHOTON_URL: 'ftp://x' })).toThrow(/PHOTON_URL/);
  });

  it('parseurs tolérants (entrées invalides → liste vide)', () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: [{ geometry: { coordinates: ['x', 1] }, properties: {} }] })).toEqual([]);
    expect(parseTomTomSearch({ results: [{ type: 'POI', position: {} }] })).toEqual([]);
  });
});

describe('POST /v1/search — validation, confidentialité, limite', () => {
  const noCall = () => {
    throw new Error('aucun appel attendu');
  };
  it.each([
    [{}, 400, 'invalid_body'],
    [{ q: 'a' }, 400, 'query_too_short'],
    [{ q: 'x'.repeat(150) }, 400, 'query_too_long'],
    [{ q: 'rivoli', near: { lat: 95, lon: 2 } }, 400, 'invalid_coordinates'],
    [{ q: 'rivoli', extra: true }, 400, 'invalid_body'],
  ])('refuse %j', async (payload, status, code) => {
    ({ app } = await makeApp({}, { fetch: noCall }));
    const res = await post(app, payload as Record<string, unknown>);
    expect(res.statusCode).toBe(status);
    expect(res.json().error.code).toBe(code);
  });

  it('GET /v1/search → 405 (la saisie ne passe jamais dans l’URL)', async () => {
    ({ app } = await makeApp({}, { fetch: noCall }));
    const res = await app.inject('/v1/search?q=12%20rue%20du%20domicile');
    expect(res.statusCode).toBe(405);
  });

  it('les journaux ne contiennent ni la requête ni la position', async () => {
    const lines: string[] = [];
    const f = fakeFetch(() => json('{}', 500));
    ({ app } = await makeApp({}, { fetch: f.fn, logger: { level: 'info', stream: { write: (m: string) => lines.push(m) } } }));
    await post(app, { q: '12 rue du Domicile Secret', near: { lat: 48.81234, lon: 2.31234 } });
    const all = lines.join('\n');
    expect(all).toContain('échec du fournisseur de recherche');
    expect(all).not.toMatch(/Domicile|48\.81|2\.31/);
  });

  it('limite à 30 recherches par minute et par IP', async () => {
    const f = fakeFetch(() => json(PHOTON));
    ({ app } = await makeApp({ RATE_LIMIT_MAX: '1000' }, { fetch: f.fn }));
    for (let i = 0; i < 30; i++) expect((await post(app, { q: `rivoli ${i}` })).statusCode).toBe(200);
    const res = await post(app, { q: 'rivoli' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('rate_limited');
    expect((await post(app, { q: 'rivoli' }, '198.51.100.7')).statusCode).toBe(200);
  });
});
