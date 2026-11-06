// Correctifs navigation V2 : recalage fenêtré, contresens, rafraîchissement / bascule, batterie, tronçon parcouru, repli client.
import { describe, expect, it, vi } from 'vitest';
import { checkFresh, liveArrivalSoc, offerDefault, remapAnnounced, socNowEstimate, trafficSegmentsFrom, type VehicleLike } from './guidance';
import { angleDiff, cumulative, progressNear, progressOnRoute, segmentBearing, type LonLat, type RouteOption, type RouteStep } from './navigation';
import { QuotaError, Throttle } from './valhallaClient';
import { parseValhallaResponse } from './valhallaParse';

const east: LonLat[] = Array.from({ length: 21 }, (_, i) => [2.3 + i * 0.01, 48.75]);
const opt = (id: string, geometry: LonLat[], durationS: number, steps: RouteStep[] = []): RouteOption => ({
  id, durationS, trafficDelayS: 0, distanceM: 14660, hasTolls: false, hasMotorways: false, geometry, steps, trafficSections: [],
});

describe('recalage dans une fenêtre autour de la progression précédente', () => {
  // Aller-retour sur la même route : l'aller (0..10) puis le retour (10..20) sur les mêmes points.
  const back: LonLat[] = [...east.slice(0, 11), ...east.slice(0, 10).reverse()];
  const cum = cumulative(back);
  it('sans fenêtre, la projection peut tomber sur le mauvais passage ; avec, elle reste sur l’aller', () => {
    const p = { lon: 2.3 + 3.02 * 0.01, lat: 48.75 };
    const near = progressNear(p, back, cum, cum[3]!, 150, 1500);
    expect(near.windowed).toBe(true);
    expect(near.seg).toBe(3);
    // Sur le retour, la même position est reconnue sur le retour.
    const ret = progressNear(p, back, cum, cum[17]!, 150, 1500);
    expect(ret.seg).toBeGreaterThanOrEqual(16);
  });
  it('hors fenêtre et loin : recherche globale si nettement meilleure', () => {
    const p = { lon: 2.3 + 9.5 * 0.01, lat: 48.75 };
    const r = progressNear(p, east, cumulative(east), 0, 150, 1500);
    expect(r.windowed).toBe(false);
    expect(Math.round(r.along)).toBe(Math.round(progressOnRoute(p, east).along));
  });
  it('cap du segment et écart angulaire (contresens > 120°)', () => {
    expect(Math.round(segmentBearing(east, 0)!)).toBe(90);
    expect(angleDiff(270, segmentBearing(east, 0)!)).toBeGreaterThan(120);
    expect(angleDiff(350, 10)).toBe(20);
  });
});

describe('vérification toutes les 2 min : même trajet frais, trajet plus rapide proposé', () => {
  const north: LonLat[] = Array.from({ length: 21 }, (_, i) => [2.3 + i * 0.01, 48.75 + (i > 0 && i < 20 ? 0.02 : 0)]);
  it('le même trajet recalculé donne la durée fraîche ; pas de bascule sans gain', () => {
    const r = checkFresh(east, 1200, [opt('a', east, 1300)]);
    expect(r.same?.durationS).toBe(1300);
    expect(r.faster).toBeNull();
  });
  it('trajet nettement plus rapide que le trajet suivi recalculé → proposé', () => {
    const r = checkFresh(east, 1200, [opt('b', north, 700), opt('a', east, 1300)]);
    expect(r.same?.id).toBe('a');
    expect(r.faster?.route.id).toBe('b');
    expect(r.faster?.gainS).toBe(600);
  });
  it('comparaison avec le trajet choisi recalculé, pas avec l’ancienne estimation', () => {
    // Estimation restante 900 s mais trajet suivi recalculé 1000 s : l'alternative 800 s ne gagne que 200 s.
    expect(checkFresh(east, 900, [opt('b', north, 800), opt('a', east, 1000)]).faster?.gainS).toBe(200);
  });
  it('refusé : pas re-proposé sauf gain amélioré de 3 min', () => {
    const declined = { geometry: north, gainS: 600 };
    expect(checkFresh(east, 1200, [opt('b', north, 700), opt('a', east, 1300)], declined).faster).toBeNull();
    expect(checkFresh(east, 1200, [opt('b', north, 400), opt('a', east, 1300)], declined).faster?.gainS).toBe(900);
  });
  it('défaut du décompte : garder si le conducteur avait choisi une alternative, prendre sinon', () => {
    expect(offerDefault(true)).toBe('keep');
    expect(offerDefault(false)).toBe('take');
  });
  it('annonces déjà faites reportées sur le trajet rafraîchi (pas de répétition)', () => {
    const s = (lon: number, maneuver: RouteStep['maneuver']): RouteStep => ({ instruction: '', distanceM: 0, lon, lat: 48.75, maneuver });
    const done = new Set(['s1:far', 's1:mid', 'z9', 's2:far']);
    const out = remapAnnounced([s(2.3, 'depart'), s(2.35, 'turn-left'), s(2.4, 'turn-right')], [s(2.33, 'depart'), s(2.35, 'turn-left'), s(2.4, 'turn-right')], done);
    expect([...out].sort()).toEqual(['s1:far', 's1:mid', 's2:far', 'z9']);
  });
});

describe('batterie en guidage', () => {
  const v: VehicleLike = { name: 'R5', batteryKWh: 50, consumptionKWhPer100: 20, socPercent: 30, plugs: ['ccs'] };
  const socAfter = (x: VehicleLike, soc: number, m: number) => soc - (((m / 1000) * x.consumptionKWhPer100) / 100 / x.batteryKWh) * 100;
  it('arrivée = batterie actuelle estimée − conso restante, jamais remontante', () => {
    const now = socNowEstimate(v, socAfter, 10_000, 50); // 10 km × 1,05 → −4,2 %
    expect(now).toBeCloseTo(25.8, 1);
    const a = liveArrivalSoc(v, socAfter, now, 50_000, 3000, null); // 50 km × 1,05 → −21 %
    expect(a).toBe(5);
    // Estimation suivante plus favorable (bruit GPS) : on garde la plus basse.
    expect(liveArrivalSoc(v, socAfter, now + 2, 50_000, 3000, a)).toBe(5);
    expect(liveArrivalSoc(v, socAfter, now - 2, 50_000, 3000, a)).toBe(3);
  });
});

describe('tronçon parcouru : le trafic déjà passé n’est plus coloré', () => {
  it('sections tronquées à la position', () => {
    const r = { geometry: east, trafficSections: [{ startIndex: 2, endIndex: 5, delayS: 120, magnitude: 3 }, { startIndex: 10, endIndex: 12, delayS: 60, magnitude: 2 }] };
    expect(trafficSegmentsFrom(r, 8).length).toBe(1);
    expect(trafficSegmentsFrom(r, 4)[0]!.coords[0]).toEqual(east[4]);
  });
});

describe('repli client Valhalla (site statique)', () => {
  it('limiteur : espacement minimal et plafond par fenêtre', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const th = new Throttle(2000, 600_000, 3, () => t, async (ms) => {
      sleeps.push(ms);
      t += ms;
    });
    const fn = vi.fn(async () => 'ok');
    await th.run(fn);
    t += 500;
    await th.run(fn);
    expect(sleeps).toEqual([1500]);
    await th.run(fn);
    await expect(th.run(fn)).rejects.toBeInstanceOf(QuotaError);
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('réponse complète → trajets triés, ids r0…', () => {
    const shape = 'o~a_|AsyfnCwB_E{AeC';
    const trip = (time: number) => ({ status: 0, summary: { time, length: 1 }, legs: [{ shape, maneuvers: [{ type: 1, length: 1, begin_shape_index: 0 }, { type: 4, length: 0, begin_shape_index: 2 }] }] });
    const r = parseValhallaResponse({ trip: trip(500), alternates: [{ trip: trip(400) }, { trip: { bad: 1 } }] });
    expect(r.map((x) => [x.id, x.durationS])).toEqual([['r0', 400], ['r1', 500]]);
  });
});
