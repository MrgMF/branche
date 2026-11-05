export interface LatLon {
  lat: number;
  lon: number;
}

/** Zones couvertes (rectangles larges) : métropole + Corse et DOM. Départ et arrivée doivent être dans la même. */
export const ZONES = [
  { id: 'metropole', s: 41.0, n: 51.6, w: -6.0, e: 10.0 },
  { id: 'antilles', s: 14.0, n: 18.5, w: -63.5, e: -60.5 },
  { id: 'guyane', s: 1.8, n: 6.2, w: -55.0, e: -51.2 },
  { id: 'reunion', s: -21.6, n: -20.7, w: 55.0, e: 56.0 },
  { id: 'mayotte', s: -13.2, n: -12.4, w: 44.8, e: 45.5 },
] as const;

export type ZoneId = (typeof ZONES)[number]['id'];

export function zoneOf(p: LatLon): ZoneId | null {
  for (const z of ZONES) {
    if (p.lat >= z.s && p.lat <= z.n && p.lon >= z.w && p.lon <= z.e) return z.id;
  }
  return null;
}

const NUM = '-?\\d{1,3}(?:\\.\\d{1,10})?';
const LATLON_RE = new RegExp(`^(${NUM}),(${NUM})$`);

/** « lat,lon » strict (point décimal, sans espace). */
export function parseLatLon(raw: unknown): LatLon | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const m = LATLON_RE.exec(raw.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export interface BBox {
  w: number;
  s: number;
  e: number;
  n: number;
}

/** « w,s,e,n » en degrés décimaux. */
export function parseBbox(raw: unknown): BBox | null {
  if (typeof raw !== 'string' || raw.length > 128) return null;
  const parts = raw.split(',');
  if (parts.length !== 4 || parts.some((p) => !/^-?\d{1,3}(?:\.\d{1,10})?$/.test(p.trim()))) return null;
  const [w, s, e, n] = parts.map(Number) as [number, number, number, number];
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  return { w, s, e, n };
}

export const inBbox = (b: BBox, lon: number, lat: number) => lon >= b.w && lon <= b.e && lat >= b.s && lat <= b.n;

export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const round = (x: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
};
