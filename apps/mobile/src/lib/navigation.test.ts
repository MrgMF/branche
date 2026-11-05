import { describe, expect, it } from 'vitest';
import { alongRoute, bboxOf, circle, metersBetween, progressOnRoute, type LonLat } from './navigation';


const line: LonLat[] = [
  [2.3, 48.75],
  [2.3, 48.76],
  [2.31, 48.76],
];

describe('géométrie d’itinéraire', () => {
  it('distance haversine', () => {
    expect(Math.round(metersBetween({ lat: 48.75, lon: 2.3 }, { lat: 48.76, lon: 2.3 }))).toBe(1112);
  });

  it('progression et écart', () => {
    const p = progressOnRoute({ lat: 48.755, lon: 2.3005 }, line);
    expect(p.off).toBeLessThan(50);
    expect(Math.round(p.along / 10)).toBe(56);
    expect(Math.round(p.total)).toBeGreaterThan(1800);
  });

  it('éléments sur le trajet triés par avancement', () => {
    const items = [
      { id: 'b', lat: 48.76, lon: 2.305 },
      { id: 'a', lat: 48.752, lon: 2.3 },
      { id: 'loin', lat: 48.8, lon: 2.4 },
    ];
    const r = alongRoute(items, line, 200);
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('bbox et cercle', () => {
    expect(bboxOf(line, 0)).toEqual([2.3, 48.75, 2.31, 48.76]);
    const c = circle({ id: 'z', lat: 48.75, lon: 2.3, radiusM: 1000 }, 8);
    expect(c).toHaveLength(9);
    expect(Math.abs(metersBetween({ lat: 48.75, lon: 2.3 }, { lon: c[2][0], lat: c[2][1] }) - 1000)).toBeLessThan(5);
  });
});
