import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDatex, mapType } from '../src/incidents/datex.js';
import { decodePolyline, pickFastest } from '../src/navigation/route.js';
import { redactUrl } from '../src/lib/logRedact.js';
import { loadConfig } from '../src/config.js';
import { makeApp } from './helpers.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const TOMTOM = fixture('tomtom-route.json');
const VALHALLA = fixture('valhalla-route.json');
const BISON = fixture('bison-fute-rrn-2026-09-30.xml');
const DATEX3 = fixture('datex-v3-sample.xml');

const KEY = 'tt-secret-KEY-123';
const PARIS = { lat: 48.858, lon: 2.347 };
const VERSAILLES = { lat: 48.8049, lon: 2.1301 };

/** Faux fetch : enregistre les appels, répond via `handler`. Aucun accès réseau. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}
const json = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });
const xml = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/xml' } });

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

const postRoute = (a: FastifyInstance, body: unknown, ip = '203.0.113.1') =>
  a.inject({ method: 'POST', url: '/v1/route', payload: body as Record<string, unknown>, remoteAddress: ip });

describe('POST /v1/route — TomTom', () => {
  it('appelle calculateRoute avec les bons paramètres et choisit l’alternative la plus rapide', async () => {
    const f = fakeFetch(() => json(TOMTOM));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(res.statusCode).toBe(200);
    const url = new URL(f.calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.tomtom.com/routing/1/calculateRoute/48.858,2.347:48.8049,2.1301/json');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      key: KEY,
      traffic: 'true',
      travelMode: 'car',
      routeType: 'fastest',
      maxAlternatives: '2',
      instructionsType: 'text',
      language: 'fr-FR',
      computeTravelTimeFor: 'all',
    });
    const r = res.json();
    // Route 2 de la fixture : 1720 s (la première, « principale », fait 1900 s).
    expect(r).toMatchObject({
      provider: 'tomtom',
      traffic: true,
      durationS: 1720,
      trafficDelayS: 60,
      distanceM: 19400,
      alternativesConsidered: 3,
      attribution: '© TomTom',
    });
    expect(Object.keys(r).sort()).toEqual(
      ['alternativesConsidered', 'attribution', 'distanceM', 'durationS', 'geometry', 'provider', 'steps', 'traffic', 'trafficDelayS'].sort(),
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('convertit la géométrie en [lon,lat] et les instructions en étapes', async () => {
    const f = fakeFetch(() => json(TOMTOM));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const r = (await postRoute(app, { from: PARIS, to: VERSAILLES })).json();
    expect(r.geometry).toEqual([
      [2.347, 48.858],
      [2.3204, 48.8609],
      [2.2546, 48.8442],
      [2.1301, 48.8049],
    ]);
    expect(r.steps).toEqual([
      { instruction: 'Partez de Quai de la Mégisserie (le plus rapide)', distanceM: 850, lon: 2.347, lat: 48.858 },
      { instruction: 'Tournez à droite sur Avenue de Versailles', distanceM: 18550, lon: 2.3204, lat: 48.8609 },
      { instruction: 'Vous êtes arrivé à destination', distanceM: 0, lon: 2.1301, lat: 48.8049 },
    ]);
  });

  it('ne renvoie jamais la clé, y compris en cas d’erreur du fournisseur', async () => {
    const ok = fakeFetch(() => json(TOMTOM));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: ok.fn }));
    expect((await postRoute(app, { from: PARIS, to: VERSAILLES })).body).not.toContain(KEY);
    await app.close();

    const ko = fakeFetch(() => json(`{"detailedError":{"code":"x","message":"bad key ${KEY}"}}`, 403));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: ko.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain(KEY);
    expect(res.body).not.toContain('tomtom.com');
  });

  it('pas de cache partagé : deux requêtes identiques appellent deux fois TomTom', async () => {
    const f = fakeFetch(() => json(TOMTOM));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    await postRoute(app, { from: PARIS, to: VERSAILLES });
    await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(f.calls).toHaveLength(2);
  });

  it('pickFastest : plus courte durée avec trafic, sans lissage', () => {
    const r = pickFastest([
      { id: 'a', summary: { travelTimeInSeconds: 1000 } },
      { id: 'b', summary: { travelTimeInSeconds: 999 } },
      { id: 'c', summary: { travelTimeInSeconds: 1200 } },
    ]);
    expect(r?.id).toBe('b');
  });
});

describe('POST /v1/route — repli Valhalla', () => {
  it('sans clé : Valhalla public, traffic:false, polyline6 décodée', async () => {
    const f = fakeFetch(() => json(VALHALLA));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(res.statusCode).toBe(200);
    expect(f.calls[0]!.url).toBe('https://valhalla1.openstreetmap.de/route');
    expect(f.calls[0]!.init?.method).toBe('POST');
    const sent = JSON.parse(String(f.calls[0]!.init?.body));
    expect(sent).toMatchObject({
      costing: 'auto',
      language: 'fr-FR',
      units: 'kilometers',
      locations: [
        { lat: 48.858, lon: 2.347 },
        { lat: 48.8049, lon: 2.1301 },
      ],
    });
    const r = res.json();
    expect(r).toMatchObject({
      provider: 'valhalla',
      traffic: false,
      trafficDelayS: 0,
      durationS: 1261,
      distanceM: 17750,
      alternativesConsidered: 1,
      attribution: '© contributeurs OpenStreetMap, Valhalla',
    });
    expect(r.geometry[0]).toEqual([2.347, 48.858]);
    expect(r.geometry.at(-1)).toEqual([2.1301, 48.8049]);
    expect(r.geometry).toHaveLength(5);
    expect(r.steps[1]).toEqual({ instruction: 'Tournez à droite sur Avenue de Versailles.', distanceM: 17300, lon: 2.3412, lat: 48.8566 });
  });

  it('VALHALLA_URL configurable (instance auto-hébergée)', async () => {
    const f = fakeFetch(() => json(VALHALLA));
    ({ app } = await makeApp({ VALHALLA_URL: 'https://valhalla.interne.example/route' }, { fetch: f.fn }));
    await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(f.calls[0]!.url).toBe('https://valhalla.interne.example/route');
    expect(() => loadConfig({ VALHALLA_URL: 'ftp://x' })).toThrow(/VALHALLA_URL/);
  });

  it('decodePolyline (précision 6 et 5)', () => {
    // Exemple de référence Google (précision 5).
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it.each([
    ['HTTP 500', () => json('{"error":"boom"}', 500)],
    ['JSON invalide', () => json('<html>')],
    ['réponse vide', () => json('{"trip":{"status":442,"summary":{},"legs":[]}}')],
    ['réseau', () => Promise.reject(new TypeError('fetch failed'))],
  ])('502 si le fournisseur échoue (%s)', async (_label, handler) => {
    const f = fakeFetch(handler as () => Response);
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: { code: 'route_provider_error', message: 'Le service d’itinéraire est indisponible, réessayez dans quelques instants.' },
    });
  });
});

describe('POST /v1/route — validation', () => {
  const noCall = () => {
    throw new Error('aucun appel attendu');
  };

  it('GET /v1/route → 405 avec message (coordonnées interdites dans l’URL)', async () => {
    ({ app } = await makeApp({}, { fetch: noCall }));
    const res = await app.inject('/v1/route?from=48.85,2.34&to=48.80,2.13');
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('POST');
    expect(res.json().error.code).toBe('method_not_allowed');
    expect(res.json().error.message).toMatch(/POST \/v1\/route/);
  });

  it.each([
    [{ from: PARIS }, 'invalid_body'],
    [{ from: '48.85,2.34', to: VERSAILLES }, 'invalid_body'],
    [{ from: { lat: '48.85', lon: 2.34 }, to: VERSAILLES }, 'invalid_body'],
    [{ from: PARIS, to: VERSAILLES, extra: 1 }, 'invalid_body'],
    [{ from: { lat: 95, lon: 2 }, to: VERSAILLES }, 'invalid_coordinates'],
    [{ from: { lat: 40.4, lon: -3.7 }, to: VERSAILLES }, 'out_of_area'], // Madrid
    [{ from: PARIS, to: { lat: -20.9, lon: 55.5 } }, 'out_of_area'], // Paris → La Réunion
    [{ from: PARIS, to: PARIS }, 'same_point'],
  ])('refuse %j (400 %s)', async (body, code) => {
    ({ app } = await makeApp({}, { fetch: noCall }));
    const res = await postRoute(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });

  it('refuse un trajet > 1500 km (Dunkerque → Bonifacio ≈ 1180 km accepté, Brest → Menton ≈ 1000 km accepté)', async () => {
    const f = fakeFetch(() => json(VALHALLA));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    expect((await postRoute(app, { from: { lat: 51.03, lon: 2.37 }, to: { lat: 41.39, lon: 9.16 } })).statusCode).toBe(200);
    // Extrêmes de la zone métropole (rectangle large) : > 1500 km.
    const far = await postRoute(app, { from: { lat: 51.5, lon: -5.9 }, to: { lat: 41.1, lon: 9.9 } });
    expect(far.statusCode).toBe(400);
    expect(far.json().error).toEqual({ code: 'too_far', message: 'Trajet trop long : 1500 km maximum à vol d’oiseau.' });
  });

  it('accepte un trajet dans un DOM (Guadeloupe)', async () => {
    const f = fakeFetch(() => json(VALHALLA));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    expect((await postRoute(app, { from: { lat: 16.24, lon: -61.53 }, to: { lat: 16.0, lon: -61.73 } })).statusCode).toBe(200);
  });
});

describe('journaux sans coordonnées', () => {
  it('n’écrit ni corps, ni coordonnées précises ; bbox tronquée à 2 décimales', async () => {
    const lines: string[] = [];
    const f = fakeFetch((url) => (url.includes('valhalla') ? json(VALHALLA) : xml(BISON)));
    ({ app } = await makeApp({}, { fetch: f.fn, logger: { level: 'info', stream: { write: (m: string) => lines.push(m) } } }));
    await postRoute(app, { from: { lat: 48.858123, lon: 2.347456 }, to: VERSAILLES });
    await app.inject({ method: 'POST', url: '/v1/reports', payload: { type: 'obstacle', lon: 2.351234, lat: 48.861234 } });
    await app.inject('/v1/incidents?bbox=2.123456,48.654321,2.567891,49.012345');
    await app.inject('/v1/route?from=48.858123,2.347456');
    const log = lines.join('\n');
    expect(log).toContain('/v1/incidents?bbox=2.12,48.65,2.57,49.01');
    for (const s of ['48.858', '2.347', '2.3512', '48.8612', '2.123456', '203.0.113', '127.0.0.1', 'remoteAddress']) {
      expect(log).not.toContain(s);
    }
  });

  it('redactUrl masque tout paramètre ressemblant à une coordonnée', () => {
    expect(redactUrl('/v1/route?from=48.85,2.34&x=abc')).toBe('/v1/route?from=[masqué]&x=abc');
    expect(redactUrl('/v1/incidents?bbox=1,2,3,4')).toBe('/v1/incidents?bbox=1.00,2.00,3.00,4.00');
  });
});

describe('DATEX II — parseur', () => {
  it('lit le flux réel Bison Futé (SOAP + DATEX v2, 30/09/2026)', () => {
    const r = parseDatex(BISON);
    expect(r.publicationTime).toBe('2026-09-30T18:57:44.901Z');
    expect(r.incidents).toHaveLength(14);
    const first = r.incidents.find((i) => i.id === 'bf-260925-000150-1');
    expect(first).toEqual({
      id: 'bf-260925-000150-1',
      type: 'travaux',
      title: 'Travaux de revêtement · N58',
      description: 'Arrêté n°T 26 – 484 / 08\nsur bretelle de sortie\nDe Belgique vers Charleville',
      lon: 4.994919,
      lat: 49.68538,
      start: '2026-10-05T04:00:00.000Z',
      end: '2026-10-07T15:00:00.000Z',
      severity: 2,
      source: 'bison-fute',
    });
    const types = Object.fromEntries(r.incidents.map((i) => [i.id, i.type]));
    expect(types['bf-260930-002298-1']).toBe('fermeture'); // roadClosed (linéaire → premier point)
    expect(types['bf-251023-001144-1']).toBe('meteo'); // snowOnTheRoad
    expect(types['bf-251023-001144-2']).toBe('fermeture'); // closedPermanentlyForTheWinter
    expect(types['bf-251022-000640-1']).toBe('autre'); // laneClosures
    // Linéaire : coordonnées du point « from ».
    const closed = r.incidents.find((i) => i.id === 'bf-260930-002298-1');
    expect([closed?.lon, closed?.lat]).toEqual([6.117531, 49.230125]);
    expect(closed?.end).toBeNull();
    // Les chemins administratifs « DIR …/District …/CEI … » sont retirés.
    expect(r.incidents.every((i) => !/\/District /.test(i.description))).toBe(true);
    for (const i of r.incidents) {
      expect(i.title.length).toBeLessThanOrEqual(80);
      expect([1, 2, 3]).toContain(i.severity);
    }
  });

  it('tolère DATEX v3 (locationForDisplay, pointByCoordinates, posList, sévérité, entités)', () => {
    const r = parseDatex(DATEX3);
    expect(r.publicationTime).toBe('2026-11-05T10:58:00.000Z');
    expect(r.incidents.map((i) => [i.id, i.type, i.severity, i.lon, i.lat])).toEqual([
      ['bf-v3-001-1', 'accident', 3, 2.3051, 48.7712],
      ['bf-v3-002-1', 'bouchon', 1, 2.2316, 48.8301],
      ['bf-v3-002-2', 'obstacle', 1, 2.4, 48.9],
      ['bf-v3-002-3', 'meteo', 1, 5.7, 45.1],
    ]);
    expect(r.incidents[0]?.description).toBe('Accident & véhicule en feu, voie de gauche neutralisée');
    expect(r.incidents[1]?.title).toBe('Circulation à l’arrêt');
    expect(r.incidents[3]?.title).toBe('Brouillard');
  });

  it('mapType', () => {
    expect(mapType('Accident', [])).toBe('accident');
    expect(mapType('ConstructionWorks', [])).toBe('travaux');
    expect(mapType('AbnormalTraffic', ['queuingTraffic'])).toBe('bouchon');
    expect(mapType('AnimalPresenceObstruction', [])).toBe('obstacle');
    expect(mapType('RoadOrCarriagewayOrLaneManagement', ['roadClosed'])).toBe('fermeture');
    expect(mapType('ReroutingManagement', ['followLocalDiversion'])).toBe('autre');
    expect(mapType('Inconnu', [])).toBe('autre');
  });

  it('XML invalide ou sans situation → liste vide, sans exception', () => {
    expect(parseDatex('<a><b>').incidents).toEqual([]);
    expect(parseDatex('').incidents).toEqual([]);
  });
});

describe('GET /v1/incidents', () => {
  // La fixture est datée : on place l'horloge pendant la validité des travaux N58.
  const AT = Date.UTC(2026, 9, 6, 10, 0, 0);
  const ARDENNES = '4.9,49.6,5.1,49.8';

  it('filtre par bbox, exclut les événements terminés, cite la source', async () => {
    const f = fakeFetch(() => xml(BISON));
    const { app: a, clock } = await makeApp({}, { fetch: f.fn });
    app = a;
    clock.t = AT;
    const res = await app.inject(`/v1/incidents?bbox=${ARDENNES}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(f.calls[0]!.url).toBe('https://www.data.gouv.fr/api/1/datasets/r/d16c8cb6-0123-44e7-b8b1-f99fc6a59497');
    expect(body.updatedAt).toBe('2026-09-30T18:57:44.901Z');
    expect(body.source).toMatch(/Bison Futé.*Licence Ouverte 2\.0/);
    expect(body.incidents).toHaveLength(8);
    expect(body.incidents.every((i: { source: string }) => i.source === 'bison-fute')).toBe(true);
    // Hors fenêtre de validité (après le 07/10 17 h) : les travaux N58 disparaissent.
    clock.t = Date.UTC(2026, 9, 8);
    const later = (await app.inject(`/v1/incidents?bbox=${ARDENNES}`)).json();
    expect(later.incidents).toHaveLength(0);
  });

  it('met le flux en cache 2 min (une seule requête amont), puis rafraîchit', async () => {
    const f = fakeFetch(() => xml(BISON));
    const { app: a, clock } = await makeApp({ INCIDENTS_URL: 'https://miroir.example/content.xml' }, { fetch: f.fn });
    app = a;
    clock.t = AT;
    await app.inject(`/v1/incidents?bbox=${ARDENNES}`);
    await app.inject('/v1/incidents?bbox=-5,41,10,51');
    clock.advance(119_000);
    await app.inject(`/v1/incidents?bbox=${ARDENNES}`);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('https://miroir.example/content.xml');
    clock.advance(2_000);
    await app.inject(`/v1/incidents?bbox=${ARDENNES}`);
    expect(f.calls).toHaveLength(2);
  });

  it('flux indisponible : sert la copie en cache, sinon feedOk:false avec les signalements', async () => {
    let fail = false;
    const f = fakeFetch(() => (fail ? xml('erreur', 503) : xml(BISON)));
    const { app: a, clock } = await makeApp({}, { fetch: f.fn });
    app = a;
    clock.t = AT;
    expect((await app.inject(`/v1/incidents?bbox=${ARDENNES}`)).json().incidents).toHaveLength(8);
    fail = true;
    clock.advance(5 * 60_000);
    const stale = (await app.inject(`/v1/incidents?bbox=${ARDENNES}`)).json();
    expect(stale.feedOk).toBe(true);
    expect(stale.incidents).toHaveLength(8);
    await app.close();

    const down = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    ({ app } = await makeApp({}, { fetch: down.fn }));
    await app.inject({ method: 'POST', url: '/v1/reports', payload: { type: 'bouchon', lon: 2.35, lat: 48.86 } });
    const res = await app.inject('/v1/incidents?bbox=2.3,48.8,2.4,48.9');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ feedOk: false, updatedAt: null });
    expect(res.json().incidents).toHaveLength(1);
  });

  it.each(['', 'bbox=1,2,3', 'bbox=5,49,4,50', 'bbox=a,b,c,d', 'bbox=-10,30,20,60'])('bbox invalide « %s » → 400', async (qs) => {
    ({ app } = await makeApp({}, { fetch: () => Promise.resolve(xml(BISON)) }));
    const res = await app.inject(`/v1/incidents?${qs}`);
    expect(res.statusCode).toBe(400);
    expect(['invalid_bbox', 'bbox_too_large']).toContain(res.json().error.code);
  });
});

describe('POST /v1/reports', () => {
  const report = (a: FastifyInstance, payload: Record<string, unknown>, ip = '198.51.100.7') =>
    a.inject({ method: 'POST', url: '/v1/reports', payload, remoteAddress: ip });
  const emptyFeed = () => Promise.resolve(xml('<d2LogicalModel/>'));

  it('crée un signalement (201) inclus dans /v1/incidents, source communaute', async () => {
    const { app: a, clock } = await makeApp({}, { fetch: emptyFeed });
    app = a;
    const res = await report(app, { type: 'accident', lon: 2.351234, lat: 48.861234 });
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.id).toMatch(/^cm-[0-9a-f-]{36}$/);
    expect(r.expiresAt).toBe(new Date(clock.t + 3600_000).toISOString());
    expect(Object.keys(r).sort()).toEqual(['expiresAt', 'id']);
    const list = (await app.inject('/v1/incidents?bbox=2.3,48.8,2.4,48.9')).json();
    expect(list.incidents).toEqual([
      {
        id: r.id,
        type: 'accident',
        title: 'Accident signalé',
        description: 'Signalement d’un usager de Branché, non vérifié.',
        lon: 2.3512,
        lat: 48.8612,
        start: new Date(clock.t).toISOString(),
        end: r.expiresAt,
        severity: 3,
        source: 'communaute',
      },
    ]);
  });

  it('TTL : 1 h (accident…), 24 h pour borne_hs (horloge injectée)', async () => {
    const { app: a, clock } = await makeApp({}, { fetch: emptyFeed });
    app = a;
    await report(app, { type: 'obstacle', lon: 2.35, lat: 48.86 });
    const borne = (await report(app, { type: 'borne_hs', lon: 2.36, lat: 48.87 })).json();
    expect(borne.expiresAt).toBe(new Date(clock.t + 24 * 3600_000).toISOString());
    const count = async () => (await app.inject('/v1/incidents?bbox=2.3,48.8,2.4,48.9')).json().incidents.length;
    expect(await count()).toBe(2);
    clock.advance(3600_000 - 1);
    expect(await count()).toBe(2);
    clock.advance(1);
    expect(await count()).toBe(1);
    clock.advance(23 * 3600_000);
    expect(await count()).toBe(0);
  });

  it.each(['police', 'radar', 'controle', 'meteo', 'fermeture', ''])('refuse le type « %s » (400)', async (type) => {
    ({ app } = await makeApp({}, { fetch: emptyFeed }));
    const res = await report(app, { type, lon: 2.35, lat: 48.86 });
    expect(res.statusCode).toBe(400);
    expect(['invalid_report_type', 'invalid_body']).toContain(res.json().error.code);
  });

  it.each([
    [{ type: 'accident', lon: 2.35 }],
    [{ type: 'accident', lon: '2.35', lat: 48.86 }],
    [{ type: 'accident', lon: 200, lat: 48.86 }],
    [{ type: 'accident', lon: -3.7, lat: 40.4 }],
    [{ type: 'accident', lon: 2.35, lat: 48.86, deviceId: 'abc' }],
  ])('refuse des coordonnées ou champs invalides %j (400)', async (payload) => {
    ({ app } = await makeApp({}, { fetch: emptyFeed }));
    expect((await report(app, payload)).statusCode).toBe(400);
  });

  it('limite à 10 signalements par heure et par IP', async () => {
    const { app: a, clock } = await makeApp({ RATE_LIMIT_MAX: '1000' }, { fetch: emptyFeed });
    app = a;
    for (let i = 0; i < 10; i++) expect((await report(app, { type: 'bouchon', lon: 2.35, lat: 48.86 })).statusCode).toBe(201);
    const over = await report(app, { type: 'bouchon', lon: 2.35, lat: 48.86 });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toEqual({ code: 'rate_limited', message: 'Trop de signalements : 10 par heure maximum.' });
    // Une autre IP n'est pas affectée.
    expect((await report(app, { type: 'bouchon', lon: 2.35, lat: 48.86 }, '198.51.100.8')).statusCode).toBe(201);
    void clock;
  });

  it('ne conserve aucune IP ni autre donnée personnelle', async () => {
    const { ReportStore } = await import('../src/incidents/service.js');
    const store = new ReportStore(() => 0);
    const r = store.add('accident', 2.351234, 48.861234);
    expect(Object.keys(r).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'lat', 'lon', 'type']);
    expect([r.lon, r.lat]).toEqual([2.3512, 48.8612]);
  });
});
