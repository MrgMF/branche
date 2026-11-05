import { describe, expect, it } from 'vitest';
import { nearbyStation } from './proximity';
import type { Station } from './stations';

const st = (id: string, lat: number, lon: number): Station => ({ id, n: id, lat, lon, p: 1, kw: 22, c: ['t2'], pay: [] });

describe('nearbyStation (« Vous êtes à X »)', () => {
  const list = [st('loin', 48.7585, 2.31), st('a', 48.7585, 2.3035), st('b', 48.7589, 2.3035)];
  it('la plus proche à moins de 60 m', () => {
    const r = nearbyStation(list, { lat: 48.7586, lon: 2.3035 });
    expect(r?.station.id).toBe('a');
    expect(r?.distanceM).toBe(11);
  });
  it('rien au-delà de 60 m, ni sans position', () => {
    expect(nearbyStation(list, { lat: 48.7600, lon: 2.3035 })).toBeNull();
    expect(nearbyStation(list, null)).toBeNull();
  });
});
