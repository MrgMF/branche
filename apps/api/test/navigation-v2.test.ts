import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodePolyline,
  encodePolyline,
  instructionFr,
  parseTomTomRoute,
  parseTraceSpeedLimits,
  parseValhallaTrip,
  stripTags,
  tomtomManeuver,
  valhallaLaneDirs,
  valhallaManeuver,
} from '../src/navigation/route.js';
import { makeApp } from './helpers.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const TOMTOM = fixture('tomtom-route-v2.json');
const VALHALLA = fixture('valhalla-route-v2.json');
const TRACE = fixture('valhalla-trace-attributes.json');
const KEY = 'tt-secret-KEY-123';
const PARIS = { lat: 48.858, lon: 2.347 };
const VERSAILLES = { lat: 48.8049, lon: 2.1301 };
const ETAMPES = { lat: 48.434, lon: 2.161 };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}
const json = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});
const postRoute = (a: FastifyInstance, body: unknown) => a.inject({ method: 'POST', url: '/v1/route', payload: body as Record<string, unknown> });

describe('POST /v1/route v2 — TomTom (sections, instructions balisées)', () => {
  it('3 trajets triés du plus rapide au plus lent, champs V1.1 = le plus rapide', async () => {
    const f = fakeFetch(() => json(TOMTOM));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.routes.map((x: { durationS: number }) => x.durationS)).toEqual([1720, 1900, 2080]);
    expect(r.routes.map((x: { id: string }) => x.id)).toEqual(['r0', 'r1', 'r2']);
    expect(r.durationS).toBe(1720);
    expect(r.geometry).toEqual(r.routes[0].geometry);
    expect(r.steps).toEqual(r.routes[0].steps);
    expect(r.hasTolls).toBe(true);
    expect(r.routes.map((x: { hasTolls: boolean }) => x.hasTolls)).toEqual([true, false, true]);
    expect(r.routes[0].hasMotorways).toBe(true);
    expect(r.options).toEqual({ avoidTolls: false, avoidMotorways: false });
    expect(res.body).not.toContain(KEY);
  });

  it('options éviter péages / autoroutes → avoid=tollRoads&avoid=motorways', async () => {
    const f = fakeFetch(() => json(TOMTOM));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES, options: { avoidTolls: true, avoidMotorways: true } });
    expect(res.statusCode).toBe(200);
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.getAll('avoid')).toEqual(['tollRoads', 'motorways']);
    expect(res.json().options).toEqual({ avoidTolls: true, avoidMotorways: true });
  });

  it('étape (via) : location intermédiaire, pas d’alternatives', async () => {
    const f = fakeFetch(() => json(TOMTOM));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: ETAMPES, via: [VERSAILLES] });
    expect(res.statusCode).toBe(200);
    const url = new URL(f.calls[0]!.url);
    expect(url.pathname).toBe('/routing/1/calculateRoute/48.858,2.347:48.8049,2.1301:48.434,2.161/json');
    expect(url.searchParams.get('maxAlternatives')).toBe('0');
  });

  it('manœuvres normalisées : rond-point 2e sortie, autoroute, sortie 4, voies, rue suivante', () => {
    const route = parseTomTomRoute(JSON.parse(TOMTOM).routes[1])!;
    expect(route.steps.map((s) => s.maneuver)).toEqual(['depart', 'turn-right', 'roundabout', 'merge', 'exit-right', 'arrive']);
    const rb = route.steps[2]!;
    expect(rb).toMatchObject({ exit: 2, street: 'Avenue de Suffren', angle: 80, pointIndex: 3, instruction: 'Au rond-point, prenez la 2e sortie sur Avenue de Suffren' });
    expect(route.steps[3]).toMatchObject({ street: 'A13/E5', towards: 'Rouen', instruction: "Prenez l'autoroute A13 vers Rouen" });
    const exit = route.steps[4]!;
    expect(exit).toMatchObject({ exitNumber: '4', towards: 'Versailles-Centre', street: 'D182' });
    expect(exit.lanes).toEqual([
      { directions: ['straight'], active: false },
      { directions: ['straight'], active: false },
      { directions: ['slight-right'], active: true },
    ]);
    // Distances : écart entre offsets successifs ; offsetM croissant.
    expect(route.steps[0]!.distanceM).toBe(route.steps[1]!.offsetM);
    expect(route.steps.map((s) => s.offsetM)).toEqual([...route.steps.map((s) => s.offsetM)].sort((a, b) => a - b));
  });

  it('sections : trafic (retard, gravité), limitations de vitesse, voies', () => {
    const route = parseTomTomRoute(JSON.parse(TOMTOM).routes[1])!;
    expect(route.trafficSections).toEqual([
      { startIndex: 2, endIndex: 4, delayS: 158, magnitude: 3 },
      { startIndex: 6, endIndex: 7, delayS: 82, magnitude: 1 },
    ]);
    expect(route.speedLimits).toEqual([
      { startIndex: 0, endIndex: 4, kmh: 50 },
      { startIndex: 4, endIndex: 5, kmh: 70 },
      { startIndex: 5, endIndex: 8, kmh: 110 },
      { startIndex: 8, endIndex: 9, kmh: 50 },
    ]);
    expect(route.lanes).toHaveLength(1);
    expect(route.trafficDelayS).toBe(240);
  });

  it('tomtomManeuver : table complète des codes de la documentation', () => {
    expect(tomtomManeuver('TAKE_EXIT')).toBe('exit-right');
    expect(tomtomManeuver('TAKE_EXIT', 'LEFT')).toBe('exit-left');
    expect(tomtomManeuver('ROUNDABOUT_BACK')).toBe('roundabout');
    expect(tomtomManeuver('KEEP_LEFT')).toBe('keep-left');
    expect(tomtomManeuver('BEAR_RIGHT')).toBe('slight-right');
    expect(tomtomManeuver('SHARP_LEFT')).toBe('sharp-left');
    expect(tomtomManeuver('TRY_MAKE_UTURN')).toBe('uturn');
    expect(tomtomManeuver('ENTRANCE_RAMP')).toBe('merge');
    expect(tomtomManeuver('WAYPOINT_REACHED')).toBe('waypoint');
    expect(tomtomManeuver('ARRIVE_LEFT')).toBe('arrive');
    expect(tomtomManeuver('INCONNU')).toBe('straight');
    expect(stripTags('Prenez <roadNumber>A4</roadNumber>/<roadNumber>E19</roadNumber> vers <signpostText>Den Haag</signpostText>')).toBe('Prenez A4/E19 vers Den Haag');
  });
});

describe('POST /v1/route v2 — Valhalla (alternates, rond-point, voies, limitations)', () => {
  it('requête : alternates=2, costing_options, voies ; trace_attributes pour les limitations', async () => {
    const f = fakeFetch((url) => json(url.endsWith('/trace_attributes') ? TRACE : VALHALLA));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES, options: { avoidTolls: true } });
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(String(f.calls[0]!.init?.body));
    expect(sent).toMatchObject({ alternates: 2, turn_lanes: true, costing: 'auto', costing_options: { auto: { use_tolls: 0, use_highways: 1 } } });
    const traces = f.calls.filter((c) => c.url.endsWith('/trace_attributes'));
    expect(traces).toHaveLength(2);
    expect(JSON.parse(String(traces[0]!.init?.body))).toMatchObject({ shape_match: 'edge_walk', costing: 'auto' });
    const r = res.json();
    expect(r.provider).toBe('valhalla');
    expect(r.traffic).toBe(false);
    // L'alternative (1240 s) est plus rapide que le trajet principal (1360 s) : elle passe en tête.
    expect(r.routes.map((x: { durationS: number }) => x.durationS)).toEqual([1240, 1360]);
    expect(r.routes[0].trafficSections).toEqual([]);
    expect(r.routes[1].hasTolls).toBe(true);
  });

  it('via : location « break », sans alternates', async () => {
    const f = fakeFetch((url) => json(url.endsWith('/trace_attributes') ? TRACE : VALHALLA));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    await postRoute(app, { from: PARIS, to: ETAMPES, via: [VERSAILLES], options: { avoidMotorways: true } });
    const sent = JSON.parse(String(f.calls[0]!.init?.body));
    expect(sent.alternates).toBeUndefined();
    expect(sent.locations).toEqual([{ lat: 48.858, lon: 2.347 }, { lat: 48.8049, lon: 2.1301, type: 'break' }, { lat: 48.434, lon: 2.161 }]);
    expect(sent.costing_options.auto.use_highways).toBe(0);
  });

  it('rond-point 26+27 fusionnés (3e sortie, rue de sortie, angle), bretelle, sortie 4, voies (masque)', () => {
    const body = JSON.parse(VALHALLA);
    const r = parseValhallaTrip(body.alternates[0].trip);
    expect(r.steps.map((s) => s.maneuver)).toEqual(['depart', 'turn-right', 'roundabout', 'keep-right', 'exit-right', 'arrive']);
    const rb = r.steps[2]!;
    expect(rb).toMatchObject({ exit: 3, street: 'Cours la Reine', angle: -90, pointIndex: 2 });
    expect(rb.distanceM).toBe(Math.round(body.alternates[0].trip.legs[0].maneuvers[2].length * 1000) + Math.round(body.alternates[0].trip.legs[0].maneuvers[3].length * 1000));
    expect(r.steps[3]).toMatchObject({ street: 'A13', towards: 'Rouen' });
    expect(r.steps[3]!.lanes).toEqual([
      { directions: ['straight'], active: false },
      { directions: ['straight'], active: false },
      { directions: ['straight', 'slight-right'], active: true },
    ]);
    expect(r.steps[4]).toMatchObject({ exitNumber: '4', towards: 'Versailles-Centre', instruction: 'Prenez la sortie 4 à droite vers Versailles-Centre.' });
    expect(r.hasMotorways).toBe(true);
  });

  it('limitations depuis trace_attributes : fusion des tronçons égaux, arêtes sans limite ignorées', () => {
    const trip = parseValhallaTrip(JSON.parse(VALHALLA).alternates[0].trip);
    expect(parseTraceSpeedLimits(JSON.parse(TRACE), trip.geometry.length)).toEqual([
      { startIndex: 0, endIndex: 3, kmh: 50 },
      { startIndex: 3, endIndex: 4, kmh: 70 },
      { startIndex: 4, endIndex: 6, kmh: 110 },
    ]);
    // Forme différente → indices non fiables → aucune limitation.
    expect(parseTraceSpeedLimits(JSON.parse(TRACE), 3)).toEqual([]);
  });

  it('trace_attributes en panne : itinéraire servi sans limitations', async () => {
    const f = fakeFetch((url) => (url.endsWith('/trace_attributes') ? json('{}', 500) : json(VALHALLA)));
    ({ app } = await makeApp({}, { fetch: f.fn }));
    const res = await postRoute(app, { from: PARIS, to: VERSAILLES });
    expect(res.statusCode).toBe(200);
    expect(res.json().routes[0].speedLimits).toBeUndefined();
  });

  it('jambes multiples : étape « waypoint », pas de second départ, indices globaux', () => {
    const leg = (shape: [number, number][]) => ({
      shape: encodePolyline(shape),
      maneuvers: [
        { type: 1, instruction: 'Partez.', length: 1, begin_shape_index: 0 },
        { type: 15, instruction: 'Tournez à gauche.', length: 1, begin_shape_index: 1 },
        { type: 4, instruction: 'Arrivée.', length: 0, begin_shape_index: 2 },
      ],
    });
    const r = parseValhallaTrip({
      status: 0,
      summary: { time: 100, length: 4 },
      legs: [leg([[2, 48], [2.01, 48], [2.02, 48]]), leg([[2.02, 48], [2.03, 48], [2.04, 48]])],
    });
    expect(r.geometry).toHaveLength(5);
    expect(r.steps.map((s) => [s.maneuver, s.pointIndex, s.offsetM])).toEqual([
      ['depart', 0, 0],
      ['turn-left', 1, 1000],
      ['waypoint', 2, 2000],
      ['turn-left', 3, 3000],
      ['arrive', 4, 4000],
    ]);
  });

  it('valhallaManeuver et masque de voies', () => {
    expect([20, 21, 23, 24, 25, 12, 9, 16, 26].map(valhallaManeuver)).toEqual([
      'exit-right',
      'exit-left',
      'keep-right',
      'keep-left',
      'merge',
      'uturn',
      'slight-right',
      'slight-left',
      'roundabout',
    ]);
    expect(valhallaLaneDirs(8 | 2)).toEqual(['straight', 'left']);
    expect(encodePolyline(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), 5)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('instructionFr : consignes générées en français', () => {
    expect(instructionFr({ maneuver: 'roundabout', exit: 1, street: 'Rue Velpeau' })).toBe('Au rond-point, prenez la 1re sortie sur Rue Velpeau');
    expect(instructionFr({ maneuver: 'exit-right', exitNumber: '12', towards: 'Orly' })).toBe('Prenez la sortie 12 à droite vers Orly');
    expect(instructionFr({ maneuver: 'keep-left' })).toBe('Restez à gauche');
  });
});

describe('POST /v1/route v2 — validation', () => {
  const noCall = () => {
    throw new Error('aucun appel attendu');
  };
  it.each([
    [{ from: PARIS, to: VERSAILLES, via: [PARIS, PARIS, PARIS, PARIS] }, 'invalid_body'],
    [{ from: PARIS, to: VERSAILLES, options: { avoidTolls: 'oui' } }, 'invalid_body'],
    [{ from: PARIS, to: VERSAILLES, options: { avoidFerries: true } }, 'invalid_body'],
    [{ from: PARIS, to: VERSAILLES, via: [{ lat: 16.24, lon: -61.53 }] }, 'out_of_area'],
    [{ from: PARIS, to: VERSAILLES, via: [{ lat: 95, lon: 2 }] }, 'invalid_coordinates'],
  ])('refuse %j (400 %s)', async (body, code) => {
    ({ app } = await makeApp({}, { fetch: noCall }));
    const res = await postRoute(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });
});
