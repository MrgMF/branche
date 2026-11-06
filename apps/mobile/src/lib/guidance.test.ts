import { describe, expect, it } from 'vitest';
import {
  announcementText,
  arrivalSoc,
  bigDist,
  chargersOnRoute,
  deltaText,
  fasterRoute,
  isOverSpeed,
  nextStepIndex,
  pickAnnouncement,
  sameRoute,
  speedKmh,
  speedLimitAt,
  spokenDist,
  stepsAlong,
  trafficSegments,
  type VehicleLike,
} from './guidance';
import type { LonLat, RouteOption, RouteStep } from './navigation';
import type { Station } from './stations';

// Ligne droite plein est à 48,75° N : 0,01° de longitude ≈ 733 m.
const line: LonLat[] = Array.from({ length: 21 }, (_, i) => [2.3 + i * 0.01, 48.75]);
const route = (over: Partial<RouteOption> = {}): RouteOption => ({
  id: 'r0',
  durationS: 1200,
  trafficDelayS: 0,
  distanceM: 14660,
  hasTolls: false,
  hasMotorways: false,
  geometry: line,
  steps: [],
  trafficSections: [],
  ...over,
});
const step = (instruction: string, over: Partial<RouteStep> = {}): RouteStep => ({ instruction, distanceM: 0, lon: 0, lat: 0, ...over });

describe('affichage', () => {
  it('distances lisibles et parlées', () => {
    expect(bigDist(1234)).toEqual({ value: '1,2', unit: 'km' });
    expect(bigDist(437)).toEqual({ value: '450', unit: 'm' });
    expect(bigDist(84)).toEqual({ value: '80', unit: 'm' });
    expect(spokenDist(1480)).toBe('1,5 kilomètre');
    expect(spokenDist(2100)).toBe('2 kilomètres');
    expect(spokenDist(480)).toBe('500 mètres');
    expect(spokenDist(96)).toBe('100 mètres');
    expect(deltaText(370)).toBe('+6 min');
    expect(deltaText(20)).toBe('Même durée');
  });
});

describe('annonces vocales', () => {
  it('voie rapide : 1500, 500 puis 120 m, une seule fois chacune', () => {
    const done = new Set<string>();
    const said = [2000, 1490, 1200, 520, 480, 300, 110, 50].map((d) => pickAnnouncement(3, d, 5000, 110, done));
    expect(said).toEqual([null, 'far', null, null, 'mid', null, 'near', null]);
  });

  it('en ville : seuils plus courts', () => {
    const done = new Set<string>();
    expect(pickAnnouncement(1, 500, 2000, 30, done)).toBeNull();
    expect(pickAnnouncement(1, 390, 2000, 30, done)).toBe('far');
    expect(pickAnnouncement(1, 140, 2000, 30, done)).toBe('mid');
    expect(pickAnnouncement(1, 35, 2000, 30, done)).toBe('near');
  });

  it('GPS qui saute directement près de la manœuvre : seule l’annonce proche est dite', () => {
    const done = new Set<string>();
    expect(pickAnnouncement(2, 60, 3000, 50, done)).toBe('near');
    expect(pickAnnouncement(2, 40, 3000, 50, done)).toBeNull();
  });

  it('tronçon court : pas d’annonce lointaine, seulement l’imminente', () => {
    const done = new Set<string>();
    expect(pickAnnouncement(4, 130, 130, 110, done)).toBeNull();
    expect(pickAnnouncement(4, 100, 130, 110, done)).toBe('near');
  });

  it('texte : distance parlée et enchaînement « puis »', () => {
    const rb = step('Au rond-point, prenez la 2e sortie sur Avenue de Suffren', { maneuver: 'roundabout', exit: 2 });
    expect(announcementText('mid', 480, rb)).toBe('Dans 500 mètres, au rond-point, prenez la 2e sortie sur Avenue de Suffren.');
    expect(announcementText('near', 90, rb, { step: step('Tournez à gauche sur Rue Velpeau.'), gapM: 80 })).toBe(
      'Au rond-point, prenez la 2e sortie sur Avenue de Suffren, puis tournez à gauche sur Rue Velpeau.',
    );
  });

  it('étapes : abscisse offsetM, prochaine manœuvre hors départ', () => {
    const r = route({ steps: [step('Partez', { maneuver: 'depart', offsetM: 0 }), step('À droite', { maneuver: 'turn-right', offsetM: 700 }), step('Arrivée', { maneuver: 'arrive', offsetM: 14000 })] });
    const along = stepsAlong(r);
    expect(along).toEqual([0, 700, 14000]);
    expect(nextStepIndex(along, r.steps, 0)).toBe(1);
    expect(nextStepIndex(along, r.steps, 800)).toBe(2);
    expect(nextStepIndex(along, r.steps, 14000)).toBe(-1);
  });
});

describe('vitesse et limitation', () => {
  it('limitation du segment courant', () => {
    const r = route({ speedLimits: [{ startIndex: 0, endIndex: 4, kmh: 50 }, { startIndex: 4, endIndex: 20, kmh: 90 }] });
    expect(speedLimitAt(r, 2)).toBe(50);
    expect(speedLimitAt(r, 4)).toBe(90);
    expect(speedLimitAt(route(), 4)).toBeNull();
    expect(isOverSpeed(54, 50)).toBe(true);
    expect(isOverSpeed(52, 50)).toBe(false);
    expect(isOverSpeed(80, null)).toBe(false);
  });

  it('vitesse : capteur, sinon dérivée des positions', () => {
    expect(speedKmh(10, null, { lat: 0, lon: 0, t: 0 })).toBeCloseTo(36);
    const v = speedKmh(null, { lat: 48.75, lon: 2.3, t: 0 }, { lat: 48.75, lon: 2.301, t: 5_000 });
    expect(Math.round(v!)).toBe(53);
    expect(speedKmh(null, null, { lat: 0, lon: 0, t: 0 })).toBeNull();
  });
});

describe('trafic et trajet plus rapide', () => {
  it('segments colorés par gravité', () => {
    const segs = trafficSegments(route({ trafficSections: [{ startIndex: 2, endIndex: 4, delayS: 158, magnitude: 3 }, { startIndex: 6, endIndex: 7, delayS: 82, magnitude: 1 }, { startIndex: 8, endIndex: 9, delayS: 0, magnitude: 0 }] }));
    expect(segs.map((s) => [s.level, s.coords.length])).toEqual([['jam', 3], ['slow', 2]]);
  });

  it('même route / route différente', () => {
    const detour: LonLat[] = line.map(([x, y], i) => [x, y + (i > 3 && i < 17 ? 0.01 : 0)]);
    expect(sameRoute(line, line.slice(5))).toBe(true);
    expect(sameRoute(line, detour)).toBe(false);
  });

  it('bascule si gain ≥ 3 min, sinon reste', () => {
    const detour: LonLat[] = line.map(([x, y], i) => [x, y + (i > 3 && i < 17 ? 0.01 : 0)]);
    const cur = route({ id: 'r1', durationS: 1300 });
    const alt = route({ id: 'r0', durationS: 1000, geometry: detour });
    expect(fasterRoute(line, 1250, [alt, cur])?.gainS).toBe(300);
    expect(fasterRoute(line, 1250, [route({ durationS: 1100, geometry: detour }), route({ durationS: 1200 })])).toBeNull();
    // Le trajet actuel reste le plus rapide : aucune bascule.
    expect(fasterRoute(line, 1250, [cur, alt])).toBeNull();
  });
});

describe('VE', () => {
  const v: VehicleLike = { name: 'Test', batteryKWh: 50, consumptionKWhPer100: 20, socPercent: 30, plugs: ['ccs', 't2'] };
  const socAfter = (x: VehicleLike, soc: number, m: number) => soc - ((((m / 1000) * x.consumptionKWhPer100) / 100) / x.batteryKWh) * 100;
  const st = (id: string, lon: number, kw: number, c: Station['c'] = ['ccs'], lat = 48.751): Station => ({ id, n: id, lat, lon, p: 2, kw, c, pay: [] });

  it('batterie à l’arrivée avec marge autoroute', () => {
    expect(arrivalSoc(v, socAfter, 50_000, 3600)).toBe(9); // 30 − 21 (marge 5 %)
    expect(arrivalSoc(v, socAfter, 50_000, 1200)).toBe(7); // 150 km/h moyen : marge 15 %
  });

  it('bornes rapides compatibles près du tracé, atteignables, les plus lointaines d’abord', () => {
    const list = [st('lente', 2.35, 22), st('chademo', 2.36, 100, ['chademo']), st('loin-du-trace', 2.37, 150, ['ccs'], 48.9), st('a', 2.33, 50), st('b', 2.4, 150), st('trop-loin', 2.49, 150)];
    const r = chargersOnRoute(list, line, { ...v, socPercent: 20 }, socAfter, 14660);
    expect(r.map((x) => x.station.id)).toEqual(['b', 'a']);
    expect(r[0].socAt).toBeGreaterThanOrEqual(8);
  });
});

import { parsePhotonClient } from './photon';
describe('recherche Photon côté app (site sans API)', () => {
  it('normalise et filtre hors territoire', () => {
    const r = parsePhotonClient({
      features: [
        { geometry: { coordinates: [2.3589, 48.85566] }, properties: { type: 'house', housenumber: '10', street: 'Rue de Rivoli', postcode: '75004', city: 'Paris' } },
        { geometry: { coordinates: [7.68, 45.07] }, properties: { type: 'street', name: 'Via Rivoli', city: 'Torino', countrycode: 'IT' } },
      ],
    });
    expect(r).toEqual([{ label: '10 Rue de Rivoli', sublabel: '75004 Paris', lat: 48.85566, lon: 2.3589, kind: 'address' }]);
  });

  it('« carrefour » : un commerce nommé (osm_key shop, type house) est un lieu, nom en titre et adresse en sous-titre', () => {
    const carrefour = { type: 'house', osm_key: 'shop', name: "Carrefour L'Haÿ-les-Roses", street: 'Avenue du Général de Gaulle', housenumber: '97', postcode: '94240', city: "L'Haÿ-les-Roses", countrycode: 'FR' };
    const r = parsePhotonClient({
      features: [
        { geometry: { coordinates: [2.34575, 48.78393] }, properties: carrefour },
        // Bâtiment nommé et lieu-dit : pas des lieux au sens commerce/équipement.
        { geometry: { coordinates: [2.35, 48.78] }, properties: { type: 'house', osm_key: 'building', name: 'Résidence A', street: 'Rue B', housenumber: '3', postcode: '94240', city: 'X' } },
        { geometry: { coordinates: [2.29, 48.75] }, properties: { type: 'city', osm_key: 'place', name: 'Antony', postcode: '92160', state: 'Île-de-France' } },
      ],
    });
    expect(r[0]).toEqual({ label: "Carrefour L'Haÿ-les-Roses", sublabel: "97 Avenue du Général de Gaulle, 94240 L'Haÿ-les-Roses", lat: 48.78393, lon: 2.34575, kind: 'poi' });
    expect(r[1]).toMatchObject({ label: '3 Rue B', kind: 'address' });
    expect(r[2]).toMatchObject({ label: 'Antony', kind: 'city' });
  });
});
