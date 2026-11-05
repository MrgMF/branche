// Itinéraire le plus rapide (trafic), perturbations et zones de danger.
import { API_URL, DATA_URL } from './config';

export type LonLat = [number, number];

/** Manœuvre normalisée par l'API (docs/api-contract-v2-navigation.md). */
export type Maneuver =
  | 'depart' | 'straight' | 'turn-left' | 'turn-right' | 'slight-left' | 'slight-right' | 'sharp-left' | 'sharp-right'
  | 'uturn' | 'roundabout' | 'exit-left' | 'exit-right' | 'keep-left' | 'keep-right' | 'merge' | 'ferry' | 'waypoint' | 'arrive';
export type LaneDir =
  | 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'uturn-left' | 'slight-right' | 'right' | 'sharp-right' | 'uturn-right' | 'merge-left' | 'merge-right';
export interface Lane {
  directions: LaneDir[];
  active: boolean;
}

export interface RouteStep {
  instruction: string;
  distanceM: number;
  lon: number;
  lat: number;
  // V2 (absents d'une API V1.1 : valeurs par défaut côté app)
  maneuver?: Maneuver;
  street?: string;
  exit?: number;
  exitNumber?: string;
  towards?: string;
  angle?: number;
  offsetM?: number;
  pointIndex?: number;
  lanes?: Lane[];
}
export interface TrafficSection {
  startIndex: number;
  endIndex: number;
  delayS: number;
  magnitude: number;
}
export interface SpeedLimitSection {
  startIndex: number;
  endIndex: number;
  kmh: number;
}
export interface RouteOption {
  id: string;
  durationS: number;
  trafficDelayS: number;
  distanceM: number;
  hasTolls: boolean;
  hasMotorways: boolean;
  geometry: LonLat[];
  steps: RouteStep[];
  trafficSections: TrafficSection[];
  speedLimits?: SpeedLimitSection[];
}
export interface RouteOptions {
  avoidTolls: boolean;
  avoidMotorways: boolean;
}
export interface Route {
  provider: 'tomtom' | 'valhalla';
  traffic: boolean;
  durationS: number;
  trafficDelayS: number;
  distanceM: number;
  geometry: LonLat[];
  steps: RouteStep[];
  alternativesConsidered?: number;
  attribution?: string;
  hasTolls?: boolean;
  routes?: RouteOption[];
  options?: RouteOptions;
}

/** Liste des trajets d'une réponse (V2 : routes[] ; V1.1 : le trajet racine seul). */
export function routeOptions(r: Route): RouteOption[] {
  if (r.routes?.length) return r.routes;
  return [{ id: 'r0', durationS: r.durationS, trafficDelayS: r.trafficDelayS, distanceM: r.distanceM, hasTolls: !!r.hasTolls, hasMotorways: false, geometry: r.geometry, steps: r.steps, trafficSections: [] }];
}

export type IncidentType = 'accident' | 'travaux' | 'fermeture' | 'bouchon' | 'obstacle' | 'meteo' | 'autre' | 'borne_hs' | 'qr_suspect';
export interface Incident {
  id: string;
  type: IncidentType;
  title: string;
  description?: string;
  lon: number;
  lat: number;
  start?: string;
  end?: string;
  severity?: number;
  source: 'bison-fute' | 'communaute';
}
export interface DangerZone {
  id: string;
  lon: number;
  lat: number;
  radiusM: number;
}

async function get<T>(url: string, ms = 20000, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `Erreur ${res.status}`);
    return body as T;
  } catch (e) {
    if (e instanceof Error && e.message && !/abort|fetch|network/i.test(e.message)) throw e;
    throw new Error('Service d’itinéraire injoignable. Vérifiez votre connexion.');
  } finally {
    clearTimeout(t);
  }
}

// POST : les coordonnées ne figurent pas dans les URL (journaux serveur).
export const getRoute = (
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  extra: { via?: { lat: number; lon: number }[]; options?: RouteOptions } = {},
) =>
  get<Route>(`${API_URL}/v1/route`, 25000, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon },
      ...(extra.via?.length ? { via: extra.via.map((v) => ({ lat: v.lat, lon: v.lon })) } : {}),
      ...(extra.options ? { options: extra.options } : {}),
    }),
  });

export interface Place {
  label: string;
  sublabel: string;
  lat: number;
  lon: number;
  kind?: 'address' | 'street' | 'poi' | 'city';
}
export interface SearchResponse {
  provider: 'tomtom' | 'photon';
  attribution: string;
  results: Place[];
}
/** Recherche d'adresse (POST : la saisie n'apparaît dans aucune URL). */
export async function searchPlaces(q: string, near?: { lat: number; lon: number } | null, signal?: AbortSignal): Promise<SearchResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q, ...(near ? { near: { lat: near.lat, lon: near.lon } } : {}) }),
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new Error('Recherche indisponible. Vérifiez votre connexion.');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<SearchResponse> & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? 'Recherche indisponible pour le moment.');
  return { provider: body.provider ?? 'photon', attribution: body.attribution ?? '', results: body.results ?? [] };
}

export interface IncidentFeed {
  incidents: Incident[];
  feedOk: boolean;
  updatedAt: string | null;
}
export const getIncidents = (b: [number, number, number, number]) =>
  get<Partial<IncidentFeed>>(`${API_URL}/v1/incidents?bbox=${b.map((x) => x.toFixed(4)).join(',')}`).then(
    (r): IncidentFeed => ({ incidents: r.incidents ?? [], feedOk: r.feedOk !== false, updatedAt: r.updatedAt ?? null }),
  );

export async function postReport(type: IncidentType, at: { lat: number; lon: number }) {
  const res = await fetch(`${API_URL}/v1/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, lat: at.lat, lon: at.lon }),
  });
  if (!res.ok) throw new Error('Signalement impossible pour le moment.');
}

let zonesPromise: Promise<DangerZone[]> | null = null;
export function loadDangerZones(): Promise<DangerZone[]> {
  if (!zonesPromise) {
    zonesPromise = fetch(`${DATA_URL}/danger-zones.json`)
      .then((r) => (r.ok ? r.json() : { zones: [] }))
      .then((d: { zones?: DangerZone[] }) => d.zones ?? [])
      .catch(() => {
        zonesPromise = null;
        return [];
      });
  }
  return zonesPromise;
}

// ---------- géométrie ----------
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Projection locale (équirectangulaire) d'un point sur un segment ; renvoie distance et fraction. */
function projectOnSegment(p: { lat: number; lon: number }, a: LonLat, b: LonLat) {
  const k = Math.cos(rad(p.lat));
  const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p.lon * k, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const q = { lon: (ax + t * dx) / k, lat: ay + t * dy };
  return { d: metersBetween(p, q), t };
}

/** Position de l'utilisateur rapportée à l'itinéraire : écart (m) et distance parcourue (m). */
export function progressOnRoute(p: { lat: number; lon: number }, line: LonLat[]) {
  let best = { off: Infinity, along: 0, seg: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const seg = metersBetween({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
    const { d, t } = projectOnSegment(p, a, b);
    if (d < best.off) best = { off: d, along: acc + t * seg, seg: i };
    acc += seg;
  }
  return { ...best, total: acc };
}

/** Points d'intérêt (incidents, zones) situés sur l'itinéraire, triés par distance le long du trajet. */
export function alongRoute<T extends { lat: number; lon: number }>(items: T[], line: LonLat[], maxOffM: number | ((x: T) => number)) {
  const out: (T & { alongM: number })[] = [];
  for (const it of items) {
    const { off, along } = progressOnRoute(it, line);
    const lim = typeof maxOffM === 'function' ? maxOffM(it) : maxOffM;
    if (off <= lim) out.push({ ...it, alongM: along });
  }
  return out.sort((a, b) => a.alongM - b.alongM);
}

export function bboxOf(line: LonLat[], padDeg = 0.02): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of line) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w - padDeg, s - padDeg, e + padDeg, n + padDeg];
}

export function circle(z: DangerZone, n = 40): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    const dy = (z.radiusM * Math.cos(a)) / 111320;
    const dx = (z.radiusM * Math.sin(a)) / (111320 * Math.cos(rad(z.lat)));
    out.push([z.lon + dx, z.lat + dy]);
  }
  return out;
}

export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const INCIDENT_LABEL: Record<IncidentType, string> = {
  accident: 'Accident',
  travaux: 'Travaux',
  fermeture: 'Route fermée',
  bouchon: 'Bouchon',
  obstacle: 'Obstacle',
  meteo: 'Météo',
  autre: 'Perturbation',
  borne_hs: 'Borne hors service',
  qr_suspect: 'QR code suspect',
};

export const durationText = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
export const distText = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);
