// Parité du parseur Valhalla : API (src/navigation/route.ts) et repli client du site statique
// (apps/mobile/src/lib/valhallaParse.ts) doivent produire exactement la même sortie.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePolyline, instructionFr, parseValhallaTrip, ValhallaRouteProvider, type RouteStep } from '../src/navigation/route.js';
import * as client from '../../mobile/src/lib/valhallaParse.js';

const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const SAMPLES: unknown[] = [];
for (const name of ['valhalla-route.json', 'valhalla-route-v2.json']) {
  const body = fixture(name);
  SAMPLES.push(body.trip, ...(body.alternates ?? []).map((a: { trip: unknown }) => a.trip));
}

describe('parseur Valhalla : parité API / client', () => {
  it('mêmes trajets pour toutes les réponses de référence', () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(3);
    for (const trip of SAMPLES) expect(client.parseValhallaTrip(trip)).toEqual(parseValhallaTrip(trip));
  });

  it('mêmes cas limites (rond-point 26/27, étape intermédiaire, voies, panneaux, statut d’erreur)', () => {
    const shape = 'o~a_|AsyfnCwB_E{AeC';
    const trip = {
      status: 0,
      summary: { time: 300, length: 1.2, has_toll: true, has_highway: false },
      legs: [
        { shape, maneuvers: [
          { type: 1, instruction: '', length: 0.2, begin_shape_index: 0, street_names: ['Rue A'] },
          { type: 26, roundabout_exit_count: 2, length: 0.05, begin_shape_index: 1, bearing_before: 10, street_names: [] },
          { type: 27, street_names: ['Rue B'], length: 0.3, begin_shape_index: 2, bearing_after: 100 },
          { type: 21, length: 0.3, begin_shape_index: 2, sign: { exit_number_elements: [{ text: '12' }], exit_toward_elements: [{ text: 'Lyon' }, { text: 'Paris' }] }, lanes: [{ directions: 8, active: 8 }, { directions: 2 }] },
          { type: 4, length: 0, begin_shape_index: 3 },
        ] },
        { shape, maneuvers: [{ type: 1, length: 0.1, begin_shape_index: 0 }, { type: 5, instruction: 'Arrivée', length: 0, begin_shape_index: 3 }] },
      ],
    };
    expect(client.parseValhallaTrip(trip)).toEqual(parseValhallaTrip(trip));
    expect(() => client.parseValhallaTrip({ ...trip, status: 442 })).toThrow();
    expect(() => parseValhallaTrip({ ...trip, status: 442 })).toThrow();
    expect(() => client.parseValhallaTrip({})).toThrow();
  });

  it('mêmes consignes générées et même décodage', () => {
    const steps: Pick<RouteStep, 'maneuver' | 'street' | 'exit' | 'exitNumber' | 'towards'>[] = (
      ['depart', 'straight', 'turn-left', 'roundabout', 'exit-right', 'keep-left', 'merge', 'waypoint', 'arrive'] as const
    ).map((maneuver) => ({ maneuver, street: 'A6', exit: 2, exitNumber: '4', towards: 'Lyon' }));
    for (const s of steps) expect(client.instructionFr(s)).toBe(instructionFr(s));
    expect(client.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5));
  });

  it('même corps de requête /route', () => {
    const p = new ValhallaRouteProvider('http://x/route', async () => new Response());
    const req = { from: { lat: 48.1234567, lon: 2.1 }, to: { lat: 48.2, lon: 2.2 }, via: [{ lat: 48.15, lon: 2.15 }], options: { avoidTolls: true, avoidMotorways: false } };
    expect(client.valhallaRequestBody(req)).toEqual(p.requestBody(req));
    expect(client.valhallaRequestBody({ ...req, via: [] })).toEqual(p.requestBody({ ...req, via: [] }));
  });
});
