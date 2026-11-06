import { afterEach, describe, expect, it } from 'vitest';
import { setUnits } from '../i18n';
import { speedUnit, speedValue } from '../i18n/format';
import type { LonLat } from './navigation';
import { LINGER_MS, limitNear, OVER_HOLD_MS, OVER_IDLE, SPEEDO_IDLE, STALE_MS, stepOver, stepSpeedo, type OverState, type SpeedoState } from './speedo';

/** Mesures successives (km/h) toutes les `dt` ms sous une limitation ; renvoie l'état « rouge » après chaque mesure. */
function run(speeds: number[], limit: number | null, dt = 1000) {
  let s: OverState = OVER_IDLE;
  return speeds.map((v, k) => (s = stepOver(s, v, limit, k * dt)).over);
}

describe('seuil de dépassement', () => {
  it('limite + 3 km/h : 53 reste normal, 54 passe au rouge (après lissage)', () => {
    expect(run([53, 53, 53, 53], 50)).toEqual([false, false, false, false]);
    expect(run([54, 54, 54, 54], 50)).toEqual([false, false, true, true]);
  });
  it('sans limitation connue ou sans vitesse : jamais rouge', () => {
    expect(run([120, 120, 120, 120], null)).toEqual([false, false, false, false]);
    let s: OverState = OVER_IDLE;
    for (let k = 0; k < 4; k++) s = stepOver(s, null, 50, k * 1000);
    expect(s.over).toBe(false);
  });
});

describe('lissage sur 2 s', () => {
  it('un pic isolé au-dessus du seuil ne fait pas clignoter', () => {
    expect(run([45, 62, 45, 62, 45, 62], 50)).toEqual([false, false, false, false, false, false]);
  });
  it('bascule exactement après 2 s continues', () => {
    let s = stepOver(OVER_IDLE, 62, 50, 0);
    expect(s.over).toBe(false);
    s = stepOver(s, 62, 50, OVER_HOLD_MS - 1);
    expect(s.over).toBe(false);
    s = stepOver(s, 62, 50, OVER_HOLD_MS);
    expect(s.over).toBe(true);
  });
  it('retour : immédiat sous la limitation, lissé entre la limitation et le seuil', () => {
    const on: OverState = { over: true, since: null };
    expect(stepOver(on, 45, 50, 0).over).toBe(false);
    let s = stepOver(on, 52, 50, 0);
    expect(s.over).toBe(true);
    s = stepOver(s, 52, 50, 1000);
    expect(s.over).toBe(true);
    s = stepOver(s, 52, 50, 2000);
    expect(s.over).toBe(false);
  });
  it('limitation perdue (fin de tronçon, hors trajet) : retour immédiat', () => {
    expect(stepOver({ over: true, since: null }, 62, null, 0).over).toBe(false);
  });
});

describe('compteur : visibilité et fraîcheur', () => {
  const step = (s: SpeedoState, kmh: number | null, receivedAt: number | null, now: number, guiding = false, limitKmh: number | null = 50) =>
    stepSpeedo(s, { kmh, receivedAt, limitKmh, guiding }, now);

  it('hors guidage : caché à l’arrêt, visible dès 5 km/h, gardé 20 s après l’arrêt', () => {
    let r = step(SPEEDO_IDLE, 3, 0, 0);
    expect(r.view.show).toBe(false);
    r = step(r.state, 6, 1000, 1000);
    expect(r.view.show).toBe(true);
    r = step(r.state, 0, 2000, 2000);
    expect(r.view.show).toBe(true);
    expect(r.view.kmh).toBe(0);
    r = step(r.state, 0, 1000 + LINGER_MS + 1, 1000 + LINGER_MS + 1);
    expect(r.view.show).toBe(false);
  });
  it('en guidage : toujours visible, même sans mesure', () => {
    expect(step(SPEEDO_IDLE, null, null, 0, true).view).toEqual({ show: true, kmh: null, over: false });
  });
  it('mesure de plus de 5 s : vitesse inconnue et pas de rouge', () => {
    let r = step(SPEEDO_IDLE, 62, 0, 0, true);
    r = step(r.state, 62, 2000, 2000, true);
    expect(r.view.over).toBe(true);
    r = step(r.state, 62, 2000, 2000 + STALE_MS + 1, true);
    expect(r.view.kmh).toBeNull();
    expect(r.view.over).toBe(false);
  });
  it('45 puis 62 km/h sous une limite de 50 : normal, puis rouge après 2 s', () => {
    let r = step(SPEEDO_IDLE, 45, 0, 0);
    expect(r.view).toEqual({ show: true, kmh: 45, over: false });
    r = step(r.state, 62, 1000, 1000);
    expect(r.view.over).toBe(false);
    r = step(r.state, 62, 2000, 2000);
    expect(r.view.over).toBe(false);
    r = step(r.state, 62, 2000, 3000);
    expect(r.view.over).toBe(true);
  });
  it('état inchangé : même objet (pas de re-rendu inutile)', () => {
    const r = step(SPEEDO_IDLE, 0, 0, 0);
    expect(r.state).toBe(SPEEDO_IDLE);
  });
});

describe('limitation hors guidage (dernière route calculée)', () => {
  // Ligne est-ouest à 48.75° N, ~73 m par pas de 0,001°.
  const geometry: LonLat[] = [0, 1, 2, 3, 4, 5].map((k) => [2.3 + k * 0.001, 48.75]);
  const route = { geometry, speedLimits: [{ startIndex: 0, endIndex: 3, kmh: 50 }, { startIndex: 3, endIndex: 5, kmh: 70 }] };
  it('sur le tracé : limitation du tronçon', () => {
    expect(limitNear(route, { lat: 48.75, lon: 2.3015 })).toBe(50);
    expect(limitNear(route, { lat: 48.7501, lon: 2.3045 })).toBe(70);
  });
  it('à plus de 30 m du tracé, sans tracé ou sans limitations : rien', () => {
    expect(limitNear(route, { lat: 48.7506, lon: 2.3015 })).toBeNull();
    expect(limitNear(null, { lat: 48.75, lon: 2.3015 })).toBeNull();
    expect(limitNear({ geometry }, { lat: 48.75, lon: 2.3015 })).toBeNull();
  });
});

describe('unités', () => {
  afterEach(() => setUnits('km'));
  it('km/h par défaut, mph au réglage « miles » (seuil toujours calculé en km/h)', () => {
    expect(speedValue(62)).toBe(62);
    expect(speedUnit()).toBe('km/h');
    setUnits('mi');
    expect(speedValue(62)).toBe(39);
    expect(speedValue(50)).toBe(31);
    expect(speedUnit()).toBe('mph');
    expect(run([62, 62, 62], 50)).toEqual([false, false, true]);
  });
});
