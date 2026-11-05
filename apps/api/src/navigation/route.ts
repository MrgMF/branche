import { fetchWithTimeout, type FetchLike } from '../lib/ttlCache.js';
import { round, type LatLon } from '../lib/geo.js';

export interface RouteStep {
  instruction: string;
  /** Longueur du tronçon qui suit la manœuvre (jusqu'à la suivante), en mètres. */
  distanceM: number;
  lon: number;
  lat: number;
}

export interface RouteResult {
  provider: 'tomtom' | 'valhalla';
  traffic: boolean;
  durationS: number;
  trafficDelayS: number;
  distanceM: number;
  geometry: [number, number][];
  steps: RouteStep[];
  alternativesConsidered: number;
  attribution: string;
}

export interface RouteProvider {
  readonly name: RouteResult['provider'];
  route(from: LatLon, to: LatLon): Promise<RouteResult>;
}

/** Échec du fournisseur. Le message ne contient jamais l'URL appelée (la clé TomTom y figure). */
export class RouteProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
  ) {
    super(`${provider}: ${reason}`);
    this.name = 'RouteProviderError';
  }
}

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 20 * 1024 * 1024;
const USER_AGENT = 'branche-api/1.1 (+https://github.com/branche)';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const coord = (lon: number, lat: number): [number, number] => [round(lon, 6), round(lat, 6)];
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300);

async function readJson(provider: string, res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new RouteProviderError(provider, 'réponse trop volumineuse');
  try {
    return JSON.parse(text);
  } catch {
    throw new RouteProviderError(provider, `réponse non JSON (HTTP ${res.status})`);
  }
}

async function call(provider: string, fetchFn: FetchLike, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchFn, url, { ...init, headers: { 'user-agent': USER_AGENT, ...init.headers } }, TIMEOUT_MS);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new RouteProviderError(provider, aborted ? 'délai dépassé' : 'injoignable');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new RouteProviderError(provider, `HTTP ${res.status}`);
  }
  return readJson(provider, res);
}

// ---------------------------------------------------------------- TomTom

interface TomTomRoute {
  summary: { lengthInMeters: number; travelTimeInSeconds: number; trafficDelayInSeconds: number };
  points: [number, number][];
  steps: RouteStep[];
}

function parseTomTomRoute(r: unknown): TomTomRoute | null {
  if (!isObj(r) || !isObj(r.summary) || !Array.isArray(r.legs)) return null;
  const length = num(r.summary.lengthInMeters);
  const time = num(r.summary.travelTimeInSeconds);
  if (length === null || time === null) return null;
  const points: [number, number][] = [];
  for (const leg of r.legs) {
    if (!isObj(leg) || !Array.isArray(leg.points)) continue;
    for (const p of leg.points) {
      if (!isObj(p)) continue;
      const lat = num(p.latitude);
      const lon = num(p.longitude);
      if (lat !== null && lon !== null) points.push(coord(lon, lat));
    }
  }
  if (points.length < 2) return null;
  const instructions = isObj(r.guidance) && Array.isArray(r.guidance.instructions) ? r.guidance.instructions : [];
  const raw = instructions.filter(isObj).map((i) => ({
    offset: num(i.routeOffsetInMeters) ?? 0,
    message: typeof i.message === 'string' ? clean(i.message) : '',
    lat: isObj(i.point) ? num(i.point.latitude) : null,
    lon: isObj(i.point) ? num(i.point.longitude) : null,
  }));
  const steps: RouteStep[] = [];
  raw.forEach((i, k) => {
    if (!i.message || i.lat === null || i.lon === null) return;
    const next = raw[k + 1];
    const distanceM = next ? Math.max(0, Math.round(next.offset - i.offset)) : 0;
    const [lon, lat] = coord(i.lon, i.lat);
    steps.push({ instruction: i.message, distanceM, lon, lat });
  });
  return {
    summary: { lengthInMeters: length, travelTimeInSeconds: time, trafficDelayInSeconds: num(r.summary.trafficDelayInSeconds) ?? 0 },
    points,
    steps,
  };
}

/** Choisit la route de plus courte durée avec trafic (aucun lissage). Exportée pour les tests. */
export function pickFastest<T extends { summary: { travelTimeInSeconds: number } }>(routes: T[]): T | undefined {
  return routes.reduce<T | undefined>((best, r) => (!best || r.summary.travelTimeInSeconds < best.summary.travelTimeInSeconds ? r : best), undefined);
}

export class TomTomRouteProvider implements RouteProvider {
  readonly name = 'tomtom' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike,
    private readonly baseUrl = 'https://api.tomtom.com',
  ) {}

  async route(from: LatLon, to: LatLon): Promise<RouteResult> {
    const locs = `${round(from.lat, 6)},${round(from.lon, 6)}:${round(to.lat, 6)},${round(to.lon, 6)}`;
    const qs = new URLSearchParams({
      key: this.apiKey,
      traffic: 'true',
      travelMode: 'car',
      routeType: 'fastest',
      maxAlternatives: '2',
      instructionsType: 'text',
      language: 'fr-FR',
      computeTravelTimeFor: 'all',
    });
    const body = await call('tomtom', this.fetchFn, `${this.baseUrl}/routing/1/calculateRoute/${locs}/json?${qs}`, { method: 'GET' });
    const routes = isObj(body) && Array.isArray(body.routes) ? body.routes.map(parseTomTomRoute).filter((r): r is TomTomRoute => r !== null) : [];
    const best = pickFastest(routes);
    if (!best) throw new RouteProviderError('tomtom', 'aucun itinéraire exploitable');
    return {
      provider: 'tomtom',
      traffic: true,
      durationS: Math.round(best.summary.travelTimeInSeconds),
      trafficDelayS: Math.round(best.summary.trafficDelayInSeconds),
      distanceM: Math.round(best.summary.lengthInMeters),
      geometry: best.points,
      steps: best.steps,
      alternativesConsidered: routes.length,
      attribution: '© TomTom',
    };
  }
}

// ---------------------------------------------------------------- Valhalla

/** Décodage d'une polyline encodée (Google), précision 6 par défaut → [lon, lat]. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (index >= str.length) return null;
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < str.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

export class ValhallaRouteProvider implements RouteProvider {
  readonly name = 'valhalla' as const;

  constructor(
    private readonly url: string,
    private readonly fetchFn: FetchLike,
  ) {}

  async route(from: LatLon, to: LatLon): Promise<RouteResult> {
    const body = await call('valhalla', this.fetchFn, this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locations: [
          { lat: round(from.lat, 6), lon: round(from.lon, 6) },
          { lat: round(to.lat, 6), lon: round(to.lon, 6) },
        ],
        costing: 'auto',
        units: 'kilometers',
        language: 'fr-FR',
        directions_type: 'instructions',
      }),
    });
    const trip = isObj(body) && isObj(body.trip) ? body.trip : null;
    if (!trip || !isObj(trip.summary) || !Array.isArray(trip.legs)) throw new RouteProviderError('valhalla', 'réponse inattendue');
    if (trip.status !== undefined && trip.status !== 0) throw new RouteProviderError('valhalla', `statut ${String(trip.status)}`);
    const time = num(trip.summary.time);
    const lengthKm = num(trip.summary.length);
    if (time === null || lengthKm === null) throw new RouteProviderError('valhalla', 'résumé manquant');

    const geometry: [number, number][] = [];
    const steps: RouteStep[] = [];
    for (const leg of trip.legs) {
      if (!isObj(leg) || typeof leg.shape !== 'string') continue;
      const shape = decodePolyline(leg.shape, 6);
      const maneuvers = Array.isArray(leg.maneuvers) ? leg.maneuvers.filter(isObj) : [];
      for (const m of maneuvers) {
        const idx = num(m.begin_shape_index) ?? 0;
        const p = shape[Math.min(Math.max(0, idx), shape.length - 1)];
        if (!p || typeof m.instruction !== 'string' || !m.instruction.trim()) continue;
        const [lon, lat] = coord(p[0], p[1]);
        steps.push({ instruction: clean(m.instruction), distanceM: Math.round((num(m.length) ?? 0) * 1000), lon, lat });
      }
      // Les étapes successives partagent leur point de jonction.
      const pts = shape.map(([lon, lat]) => coord(lon, lat));
      geometry.push(...(geometry.length > 0 ? pts.slice(1) : pts));
    }
    if (geometry.length < 2) throw new RouteProviderError('valhalla', 'géométrie vide');
    return {
      provider: 'valhalla',
      traffic: false,
      durationS: Math.round(time),
      trafficDelayS: 0,
      distanceM: Math.round(lengthKm * 1000),
      geometry,
      steps,
      alternativesConsidered: 1,
      attribution: '© contributeurs OpenStreetMap, Valhalla',
    };
  }
}
