import { fetchWithTimeout, type FetchLike } from '../lib/ttlCache.js';
import { haversineM, round, type LatLon } from '../lib/geo.js';

// ---------------------------------------------------------------- Types (contrat v2 : docs/api-contract-v2-navigation.md)

/** Manœuvre normalisée, identique quel que soit le fournisseur. */
export type Maneuver =
  | 'depart'
  | 'straight'
  | 'turn-left'
  | 'turn-right'
  | 'slight-left'
  | 'slight-right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn'
  | 'roundabout'
  | 'exit-left'
  | 'exit-right'
  | 'keep-left'
  | 'keep-right'
  | 'merge'
  | 'ferry'
  | 'waypoint'
  | 'arrive';

export type LaneDir =
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'uturn-left'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn-right'
  | 'merge-left'
  | 'merge-right';

export interface Lane {
  /** Directions peintes sur la voie, de gauche à droite dans le sens de circulation. */
  directions: LaneDir[];
  /** Voie à emprunter pour suivre l'itinéraire. */
  active: boolean;
}

export interface RouteStep {
  /** Consigne en français (texte du fournisseur nettoyé, sinon générée). */
  instruction: string;
  /** Longueur du tronçon qui suit la manœuvre (jusqu'à la suivante), en mètres. */
  distanceM: number;
  lon: number;
  lat: number;
  maneuver: Maneuver;
  /** Rue (ou route) empruntée après la manœuvre. */
  street?: string;
  /** Rond-point : numéro de la sortie à prendre. */
  exit?: number;
  /** Sortie d'autoroute : numéro affiché sur le panneau. */
  exitNumber?: string;
  /** Direction indiquée sur les panneaux. */
  towards?: string;
  /** Angle de la manœuvre en degrés (-180..180, positif = à droite) quand le fournisseur le donne. */
  angle?: number;
  /** Distance depuis le départ jusqu'à la manœuvre (m). */
  offsetM: number;
  /** Indice du point de la manœuvre dans `geometry`. */
  pointIndex: number;
  /** Voies à l'approche de la manœuvre, si fournies. */
  lanes?: Lane[];
}

/** Section de trafic ralenti : indices dans `geometry` (inclus). magnitude TomTom : 0 inconnu, 1 faible, 2 modéré, 3 fort, 4 route fermée/indéfini. */
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
export interface LaneSection {
  startIndex: number;
  endIndex: number;
  lanes: Lane[];
}

export interface RouteOption {
  id: string;
  durationS: number;
  trafficDelayS: number;
  distanceM: number;
  hasTolls: boolean;
  hasMotorways: boolean;
  geometry: [number, number][];
  steps: RouteStep[];
  trafficSections: TrafficSection[];
  speedLimits?: SpeedLimitSection[];
  lanes?: LaneSection[];
}

export interface RouteOptions {
  avoidTolls: boolean;
  avoidMotorways: boolean;
}

export interface RouteRequest {
  from: LatLon;
  to: LatLon;
  /** Étapes intermédiaires (ex. borne de recharge), dans l'ordre. */
  via: LatLon[];
  options: RouteOptions;
}

export interface RouteResult {
  provider: 'tomtom' | 'valhalla';
  traffic: boolean;
  // --- Champs V1.1 (compatibilité) : copie de routes[0], le plus rapide.
  durationS: number;
  trafficDelayS: number;
  distanceM: number;
  geometry: [number, number][];
  steps: RouteStep[];
  alternativesConsidered: number;
  attribution: string;
  // --- V2
  hasTolls: boolean;
  /** Le plus rapide en premier, puis jusqu'à 2 alternatives. */
  routes: RouteOption[];
  options: RouteOptions;
}

export interface RouteProvider {
  readonly name: RouteResult['provider'];
  route(req: RouteRequest): Promise<RouteResult>;
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
const USER_AGENT = 'branche-api/2.0 (+https://github.com/branche)';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? clean(x) : undefined);
const coord = (lon: number, lat: number): [number, number] => [round(lon, 6), round(lat, 6)];
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
/** Messages « tagged » TomTom : <street>…</street>, <roadNumber>… → texte simple. */
export const stripTags = (s: string) => clean(s.replace(/<\/?[a-zA-Z]+>/g, ''));

async function readJson(provider: string, res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new RouteProviderError(provider, 'réponse trop volumineuse');
  try {
    return JSON.parse(text);
  } catch {
    throw new RouteProviderError(provider, `réponse non JSON (HTTP ${res.status})`);
  }
}

async function call(provider: string, fetchFn: FetchLike, url: string, init: RequestInit, ms = TIMEOUT_MS): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchFn, url, { ...init, headers: { 'user-agent': USER_AGENT, ...init.headers } }, ms);
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

// ---------------------------------------------------------------- Utilitaires communs

/** Distance cumulée (m) le long de la géométrie, point par point. */
export function cumulative(line: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    out.push(out[i - 1]! + haversineM({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }));
  }
  return out;
}

const normAngle = (a: number) => {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return Math.round(x);
};

const ordinal = (n: number) => (n === 1 ? '1re' : `${n}e`);

/** Consigne française générée à partir de la manœuvre normalisée (repli si le fournisseur n'en donne pas). */
export function instructionFr(s: Pick<RouteStep, 'maneuver' | 'street' | 'exit' | 'exitNumber' | 'towards'>): string {
  const onto = s.street ? ` sur ${s.street}` : '';
  const toward = s.towards ? ` vers ${s.towards}` : '';
  switch (s.maneuver) {
    case 'depart':
      return `Partez${onto}`;
    case 'straight':
      return `Continuez tout droit${onto}`;
    case 'turn-left':
      return `Tournez à gauche${onto}`;
    case 'turn-right':
      return `Tournez à droite${onto}`;
    case 'slight-left':
      return `Serrez à gauche${onto}`;
    case 'slight-right':
      return `Serrez à droite${onto}`;
    case 'sharp-left':
      return `Tournez franchement à gauche${onto}`;
    case 'sharp-right':
      return `Tournez franchement à droite${onto}`;
    case 'uturn':
      return `Faites demi-tour${onto}`;
    case 'roundabout':
      return s.exit ? `Au rond-point, prenez la ${ordinal(s.exit)} sortie${onto}${toward}` : `Traversez le rond-point${onto}`;
    case 'exit-left':
    case 'exit-right':
      return `Prenez la sortie${s.exitNumber ? ` ${s.exitNumber}` : ''} à ${s.maneuver === 'exit-left' ? 'gauche' : 'droite'}${toward || onto}`;
    case 'keep-left':
      return `Restez à gauche${toward || onto}`;
    case 'keep-right':
      return `Restez à droite${toward || onto}`;
    case 'merge':
      return s.street ? `Insérez-vous sur ${s.street}` : 'Insérez-vous dans la circulation';
    case 'ferry':
      return `Prenez le bac${onto}`;
    case 'waypoint':
      return 'Vous avez atteint votre étape';
    case 'arrive':
      return 'Vous êtes arrivé à destination';
  }
}

/** Attache les voies d'une section à la manœuvre qui suit (à moins de 1,5 km). */
function attachLanes(steps: RouteStep[], sections: LaneSection[], cum: number[]): void {
  for (const sec of sections) {
    const at = cum[Math.min(sec.endIndex, cum.length - 1)] ?? 0;
    const step = steps.find((s) => s.maneuver !== 'depart' && s.pointIndex >= sec.endIndex);
    if (step && !step.lanes && step.offsetM - at <= 1500) step.lanes = sec.lanes;
  }
}

const sortFastest = (routes: RouteOption[]) =>
  routes.sort((a, b) => a.durationS - b.durationS).map((r, i) => ({ ...r, id: `r${i}` }));

function result(provider: RouteResult['provider'], routes: RouteOption[], options: RouteOptions, attribution: string): RouteResult {
  const best = routes[0]!;
  return {
    provider,
    traffic: provider === 'tomtom',
    durationS: best.durationS,
    trafficDelayS: best.trafficDelayS,
    distanceM: best.distanceM,
    geometry: best.geometry,
    steps: best.steps,
    alternativesConsidered: routes.length,
    attribution,
    hasTolls: best.hasTolls,
    routes,
    options,
  };
}

// ---------------------------------------------------------------- TomTom

const TOMTOM_MANEUVER: Record<string, Maneuver> = {
  DEPART: 'depart',
  ARRIVE: 'arrive',
  ARRIVE_LEFT: 'arrive',
  ARRIVE_RIGHT: 'arrive',
  STRAIGHT: 'straight',
  FOLLOW: 'straight',
  SWITCH_PARALLEL_ROAD: 'straight',
  SWITCH_MAIN_ROAD: 'straight',
  KEEP_RIGHT: 'keep-right',
  KEEP_LEFT: 'keep-left',
  BEAR_RIGHT: 'slight-right',
  BEAR_LEFT: 'slight-left',
  TURN_RIGHT: 'turn-right',
  TURN_LEFT: 'turn-left',
  SHARP_RIGHT: 'sharp-right',
  SHARP_LEFT: 'sharp-left',
  MAKE_UTURN: 'uturn',
  TRY_MAKE_UTURN: 'uturn',
  ENTER_MOTORWAY: 'merge',
  ENTER_FREEWAY: 'merge',
  ENTER_HIGHWAY: 'merge',
  ENTRANCE_RAMP: 'merge',
  MOTORWAY_EXIT_LEFT: 'exit-left',
  MOTORWAY_EXIT_RIGHT: 'exit-right',
  TAKE_FERRY: 'ferry',
  ROUNDABOUT_CROSS: 'roundabout',
  ROUNDABOUT_RIGHT: 'roundabout',
  ROUNDABOUT_LEFT: 'roundabout',
  ROUNDABOUT_BACK: 'roundabout',
  WAYPOINT_LEFT: 'waypoint',
  WAYPOINT_RIGHT: 'waypoint',
  WAYPOINT_REACHED: 'waypoint',
};

/**
 * Manœuvre TomTom (guidance instructions) → manœuvre normalisée. TAKE_EXIT : le côté de la sortie vient du signe de
 * `turnAngleInDecimalDegrees` (< 0 : gauche, > 0 : droite) — `drivingSide` est le côté de circulation du pays, pas
 * celui de la sortie ; il ne sert que de repli sans angle (sorties à gauche usuelles quand on roule à gauche).
 */
export function tomtomManeuver(code: unknown, turnAngle?: unknown, drivingSide?: unknown): Maneuver {
  if (code === 'TAKE_EXIT') {
    const a = num(turnAngle);
    if (a !== null && a !== 0) return a < 0 ? 'exit-left' : 'exit-right';
    return drivingSide === 'LEFT' ? 'exit-left' : 'exit-right';
  }
  return (typeof code === 'string' && TOMTOM_MANEUVER[code]) || 'straight';
}

const TOMTOM_LANE: Record<string, LaneDir> = {
  STRAIGHT: 'straight',
  SLIGHT_RIGHT: 'slight-right',
  RIGHT: 'right',
  SHARP_RIGHT: 'sharp-right',
  RIGHT_U_TURN: 'uturn-right',
  SLIGHT_LEFT: 'slight-left',
  LEFT: 'left',
  SHARP_LEFT: 'sharp-left',
  LEFT_U_TURN: 'uturn-left',
};

function sectionIdx(s: Record<string, unknown>, n: number): [number, number] | null {
  const a = num(s.startPointIndex);
  const b = num(s.endPointIndex);
  if (a === null || b === null || a < 0 || b < a || a >= n) return null;
  return [a, Math.min(b, n - 1)];
}

/** Une route TomTom (`routes[i]` de calculateRoute) → option normalisée. Exportée pour les tests. */
export function parseTomTomRoute(r: unknown): RouteOption | null {
  if (!isObj(r) || !isObj(r.summary) || !Array.isArray(r.legs)) return null;
  const length = num(r.summary.lengthInMeters);
  const time = num(r.summary.travelTimeInSeconds);
  if (length === null || time === null) return null;
  // Points de toutes les jambes, concaténés tels quels : les indices des sections et instructions s'y réfèrent.
  const geometry: [number, number][] = [];
  for (const leg of r.legs) {
    if (!isObj(leg) || !Array.isArray(leg.points)) continue;
    for (const p of leg.points) {
      if (!isObj(p)) continue;
      const lat = num(p.latitude);
      const lon = num(p.longitude);
      if (lat !== null && lon !== null) geometry.push(coord(lon, lat));
    }
  }
  if (geometry.length < 2) return null;
  const n = geometry.length;
  const cum = cumulative(geometry);

  const trafficSections: TrafficSection[] = [];
  const speedLimits: SpeedLimitSection[] = [];
  const laneSections: LaneSection[] = [];
  let hasTolls = false;
  let hasMotorways = false;
  for (const s of Array.isArray(r.sections) ? r.sections.filter(isObj) : []) {
    const type = s.sectionType;
    if (type === 'TOLL' || type === 'TOLL_ROAD') hasTolls = true;
    if (type === 'MOTORWAY') hasMotorways = true;
    const idx = sectionIdx(s, n);
    if (!idx) continue;
    if (type === 'TRAFFIC') {
      trafficSections.push({ startIndex: idx[0], endIndex: idx[1], delayS: Math.round(num(s.delayInSeconds) ?? 0), magnitude: num(s.magnitudeOfDelay) ?? 0 });
    } else if (type === 'SPEED_LIMIT') {
      const kmh = num(s.maxSpeedLimitInKmh);
      if (kmh !== null && kmh > 0 && kmh <= 200) speedLimits.push({ startIndex: idx[0], endIndex: idx[1], kmh: Math.round(kmh) });
    } else if (type === 'LANES' && Array.isArray(s.lanes)) {
      const lanes = s.lanes.filter(isObj).map((l) => {
        const dirs = (Array.isArray(l.directions) ? l.directions : []).map((d) => (typeof d === 'string' ? TOMTOM_LANE[d] : undefined)).filter((d): d is LaneDir => !!d);
        return { directions: dirs.length ? dirs : (['straight'] as LaneDir[]), active: typeof l.follow === 'string' && !!TOMTOM_LANE[l.follow] };
      });
      if (lanes.length > 0 && lanes.length <= 12) laneSections.push({ startIndex: idx[0], endIndex: idx[1], lanes });
    }
  }

  const instructions = isObj(r.guidance) && Array.isArray(r.guidance.instructions) ? r.guidance.instructions.filter(isObj) : [];
  const steps: RouteStep[] = [];
  instructions.forEach((i, k) => {
    const lat = isObj(i.point) ? num(i.point.latitude) : null;
    const lon = isObj(i.point) ? num(i.point.longitude) : null;
    if (lat === null || lon === null) return;
    const offset = num(i.routeOffsetInMeters) ?? 0;
    const next = instructions[k + 1];
    const nextOffset = next ? num(next.routeOffsetInMeters) : null;
    const maneuver = tomtomManeuver(i.maneuver, i.turnAngleInDecimalDegrees, i.drivingSide);
    const roadNumbers = Array.isArray(i.roadNumbers) ? i.roadNumbers.filter((x): x is string => typeof x === 'string').join('/') : '';
    const step: RouteStep = {
      instruction: '',
      distanceM: nextOffset !== null ? Math.max(0, Math.round(nextOffset - offset)) : 0,
      ...((): { lon: number; lat: number } => {
        const [x, y] = coord(lon, lat);
        return { lon: x, lat: y };
      })(),
      maneuver,
      offsetM: Math.round(offset),
      pointIndex: Math.min(Math.max(0, num(i.pointIndex) ?? 0), n - 1),
    };
    const street = str(i.street) ?? (roadNumbers ? clean(roadNumbers) : undefined);
    if (street) step.street = street;
    const exit = num(i.roundaboutExitNumber);
    if (maneuver === 'roundabout' && exit !== null && exit > 0) step.exit = Math.round(exit);
    const exitNumber = str(i.exitNumber);
    if (exitNumber) step.exitNumber = exitNumber;
    const towards = str(i.signpostText);
    if (towards) step.towards = towards;
    const angle = num(i.turnAngleInDecimalDegrees);
    if (angle !== null) step.angle = normAngle(angle);
    const message = typeof i.message === 'string' ? stripTags(i.message) : '';
    step.instruction = message || instructionFr(step);
    steps.push(step);
  });
  attachLanes(steps, laneSections, cum);

  const option: RouteOption = {
    id: '',
    durationS: Math.round(time),
    trafficDelayS: Math.round(num(r.summary.trafficDelayInSeconds) ?? 0),
    distanceM: Math.round(length),
    hasTolls,
    hasMotorways,
    geometry,
    steps,
    trafficSections,
  };
  if (speedLimits.length) option.speedLimits = speedLimits;
  if (laneSections.length) option.lanes = laneSections;
  return option;
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

  /** URL calculateRoute (exportée pour les tests ; contient la clé : ne jamais journaliser). */
  buildUrl(req: RouteRequest): string {
    const pts = [req.from, ...req.via, req.to].map((p) => `${round(p.lat, 6)},${round(p.lon, 6)}`).join(':');
    const qs = new URLSearchParams({
      key: this.apiKey,
      traffic: 'true',
      travelMode: 'car',
      routeType: 'fastest',
      // Avec des étapes, TomTom ne calcule pas d'alternative : une seule route.
      maxAlternatives: req.via.length ? '0' : '2',
      instructionsType: 'tagged',
      language: 'fr-FR',
      computeTravelTimeFor: 'all',
    });
    for (const s of ['traffic', 'toll', 'motorway', 'speedLimit', 'lanes']) qs.append('sectionType', s);
    if (req.options.avoidTolls) qs.append('avoid', 'tollRoads');
    if (req.options.avoidMotorways) qs.append('avoid', 'motorways');
    return `${this.baseUrl}/routing/1/calculateRoute/${pts}/json?${qs}`;
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    const body = await call('tomtom', this.fetchFn, this.buildUrl(req), { method: 'GET' });
    const parsed = isObj(body) && Array.isArray(body.routes) ? body.routes.map(parseTomTomRoute).filter((r): r is RouteOption => r !== null) : [];
    if (!parsed.length) throw new RouteProviderError('tomtom', 'aucun itinéraire exploitable');
    return result('tomtom', sortFastest(parsed).slice(0, 3), req.options, '© TomTom');
  }
}

// ---------------------------------------------------------------- Valhalla

/** Décodage d'une polyline encodée (Google), précision 6 par défaut → [lon, lat]. */
export function decodePolyline(s: string, precision = 6): [number, number][] {
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
      if (index >= s.length) return null;
      b = s.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < s.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

/** Encodage polyline (inverse de decodePolyline), entrée [lon, lat]. */
export function encodePolyline(line: [number, number][], precision = 6): string {
  const factor = 10 ** precision;
  let out = '';
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out += String.fromCharCode(x + 63);
  };
  for (const [lon, lat] of line) {
    const la = Math.round(lat * factor);
    const lo = Math.round(lon * factor);
    enc(la - pLat);
    enc(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}

/** Types de manœuvre Valhalla (enum DirectionsLeg.Maneuver.Type) → manœuvre normalisée. 27 (sortie de rond-point) est fusionné. */
const VALHALLA_MANEUVER: Record<number, Maneuver> = {
  1: 'depart',
  2: 'depart',
  3: 'depart',
  4: 'arrive',
  5: 'arrive',
  6: 'arrive',
  7: 'straight',
  8: 'straight',
  9: 'slight-right',
  10: 'turn-right',
  11: 'sharp-right',
  12: 'uturn',
  13: 'uturn',
  14: 'sharp-left',
  15: 'turn-left',
  16: 'slight-left',
  17: 'straight',
  18: 'keep-right',
  19: 'keep-left',
  20: 'exit-right',
  21: 'exit-left',
  22: 'straight',
  23: 'keep-right',
  24: 'keep-left',
  25: 'merge',
  26: 'roundabout',
  28: 'ferry',
  29: 'straight',
  37: 'merge',
  38: 'merge',
};
export const valhallaManeuver = (t: unknown): Maneuver => (typeof t === 'number' && VALHALLA_MANEUVER[t]) || 'straight';

/** Masque de voies Valhalla (baldr/graphconstants.h : kTurnLane*). */
const VALHALLA_LANE_BITS: [number, LaneDir][] = [
  [2, 'straight'],
  [4, 'sharp-left'],
  [8, 'left'],
  [16, 'slight-left'],
  [32, 'slight-right'],
  [64, 'right'],
  [128, 'sharp-right'],
  [256, 'uturn-left'],
  [512, 'merge-left'],
  [1024, 'merge-right'],
];
export function valhallaLaneDirs(mask: number): LaneDir[] {
  return VALHALLA_LANE_BITS.filter(([bit]) => (mask & bit) !== 0).map(([, d]) => d);
}

const names = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(clean) : []);
const signText = (sign: unknown, key: string) =>
  isObj(sign) && Array.isArray(sign[key])
    ? sign[key]
        .filter(isObj)
        .map((e) => (typeof e.text === 'string' ? clean(e.text) : ''))
        .filter(Boolean)
        .join(' / ') || undefined
    : undefined;

/** Un `trip` Valhalla → option normalisée. Exportée pour les tests. */
export function parseValhallaTrip(trip: unknown): RouteOption {
  if (!isObj(trip) || !isObj(trip.summary) || !Array.isArray(trip.legs)) throw new RouteProviderError('valhalla', 'réponse inattendue');
  if (trip.status !== undefined && trip.status !== 0) throw new RouteProviderError('valhalla', `statut ${String(trip.status)}`);
  const time = num(trip.summary.time);
  const lengthKm = num(trip.summary.length);
  if (time === null || lengthKm === null) throw new RouteProviderError('valhalla', 'résumé manquant');

  const geometry: [number, number][] = [];
  const steps: RouteStep[] = [];
  let offsetM = 0;
  const legs = trip.legs.filter(isObj);
  legs.forEach((leg, legIdx) => {
    if (typeof leg.shape !== 'string') return;
    const shape = decodePolyline(leg.shape, 6).map(([lon, lat]) => coord(lon, lat));
    // Les jambes successives partagent leur point de jonction.
    const base = geometry.length > 0 ? geometry.length - 1 : 0;
    geometry.push(...(geometry.length > 0 ? shape.slice(1) : shape));
    const maneuvers = Array.isArray(leg.maneuvers) ? leg.maneuvers.filter(isObj) : [];
    const last = legIdx === legs.length - 1;
    for (let k = 0; k < maneuvers.length; k++) {
      const m = maneuvers[k]!;
      const type = num(m.type) ?? 0;
      const lenM = Math.round((num(m.length) ?? 0) * 1000);
      if (type === 27) {
        // Sortie de rond-point : déjà décrite par l'entrée (26) ; on ajoute sa longueur au tronçon.
        const prev = steps[steps.length - 1];
        if (prev?.maneuver === 'roundabout') prev.distanceM += lenM;
        offsetM += lenM;
        continue;
      }
      let maneuver = valhallaManeuver(type);
      if (legIdx > 0 && maneuver === 'depart') {
        offsetM += lenM;
        continue; // départ d'une jambe intermédiaire : redondant avec l'arrivée à l'étape
      }
      if (maneuver === 'arrive' && !last) maneuver = 'waypoint';
      const local = Math.min(Math.max(0, num(m.begin_shape_index) ?? 0), Math.max(0, shape.length - 1));
      const p = shape[local];
      if (!p) continue;
      const step: RouteStep = { instruction: '', distanceM: lenM, lon: p[0], lat: p[1], maneuver, offsetM: Math.round(offsetM), pointIndex: base + local };
      let streetNames = names(m.street_names);
      if (maneuver === 'roundabout') {
        const exitCount = num(m.roundabout_exit_count);
        if (exitCount !== null && exitCount > 0) step.exit = Math.round(exitCount);
        const out = maneuvers[k + 1];
        if (out && num(out.type) === 27) {
          const outNames = names(out.street_names);
          if (outNames.length) streetNames = outNames;
          const before = num(m.bearing_before);
          const after = num(out.bearing_after);
          if (before !== null && after !== null) step.angle = normAngle(after - before);
        }
      } else {
        const before = num(m.bearing_before);
        const after = num(m.bearing_after);
        if (before !== null && after !== null && maneuver !== 'depart' && maneuver !== 'arrive' && maneuver !== 'waypoint') step.angle = normAngle(after - before);
      }
      if (streetNames.length) step.street = streetNames.join(' / ');
      const exitNumber = signText(m.sign, 'exit_number_elements');
      if (exitNumber) step.exitNumber = exitNumber;
      const towards = signText(m.sign, 'exit_toward_elements') ?? signText(m.sign, 'exit_branch_elements');
      if (towards) step.towards = towards;
      if (Array.isArray(m.lanes)) {
        const lanes = m.lanes.filter(isObj).map((l) => {
          const dirs = valhallaLaneDirs(num(l.directions) ?? 0);
          return { directions: dirs.length ? dirs : (['straight'] as LaneDir[]), active: (num(l.active) ?? 0) !== 0 || (num(l.valid) ?? 0) !== 0 };
        });
        if (lanes.length > 0 && lanes.length <= 12) step.lanes = lanes;
      }
      step.instruction = typeof m.instruction === 'string' && m.instruction.trim() ? clean(m.instruction) : instructionFr(step);
      steps.push(step);
      offsetM += lenM;
    }
  });
  if (geometry.length < 2) throw new RouteProviderError('valhalla', 'géométrie vide');
  return {
    id: '',
    durationS: Math.round(time),
    trafficDelayS: 0,
    distanceM: Math.round(lengthKm * 1000),
    hasTolls: trip.summary.has_toll === true,
    hasMotorways: trip.summary.has_highway === true,
    geometry,
    steps,
    trafficSections: [],
  };
}

/** Limitations de vitesse d'une réponse /trace_attributes (edges.speed_limit), indices ramenés à la géométrie. */
export function parseTraceSpeedLimits(body: unknown, pointCount: number): SpeedLimitSection[] {
  if (!isObj(body) || !Array.isArray(body.edges)) return [];
  if (typeof body.shape === 'string' && decodePolyline(body.shape, 6).length !== pointCount) return [];
  const out: SpeedLimitSection[] = [];
  for (const e of body.edges.filter(isObj)) {
    const kmh = num(e.speed_limit);
    const a = num(e.begin_shape_index);
    const b = num(e.end_shape_index);
    if (kmh === null || kmh <= 0 || kmh > 200 || a === null || b === null || b < a || b >= pointCount) continue;
    const prev = out[out.length - 1];
    if (prev && prev.kmh === kmh && prev.endIndex >= a) prev.endIndex = b;
    else out.push({ startIndex: a, endIndex: b, kmh: Math.round(kmh) });
  }
  return out;
}

export class ValhallaRouteProvider implements RouteProvider {
  readonly name = 'valhalla' as const;

  constructor(
    private readonly url: string,
    private readonly fetchFn: FetchLike,
  ) {}

  requestBody(req: RouteRequest): Record<string, unknown> {
    const loc = (p: LatLon) => ({ lat: round(p.lat, 6), lon: round(p.lon, 6) });
    return {
      locations: [loc(req.from), ...req.via.map((v) => ({ ...loc(v), type: 'break' })), loc(req.to)],
      costing: 'auto',
      // 0 = éviter autant que possible (défauts Valhalla : use_tolls 0.5, use_highways 1).
      costing_options: { auto: { use_tolls: req.options.avoidTolls ? 0 : 0.5, use_highways: req.options.avoidMotorways ? 0 : 1 } },
      // Valhalla ne calcule pas d'alternatives pour un trajet à plusieurs étapes.
      ...(req.via.length ? {} : { alternates: 2 }),
      units: 'kilometers',
      language: 'fr-FR',
      directions_type: 'instructions',
      turn_lanes: true,
    };
  }

  /** Limitations de vitesse via /trace_attributes (meilleur effort, 5 s max) : absentes si indisponibles. */
  private async speedLimits(r: RouteOption): Promise<void> {
    if (!/\/route\/?$/.test(this.url)) return;
    const traceUrl = this.url.replace(/\/route\/?$/, '/trace_attributes');
    try {
      const body = await call(
        'valhalla',
        this.fetchFn,
        traceUrl,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            encoded_polyline: encodePolyline(r.geometry, 6),
            shape_match: 'edge_walk',
            costing: 'auto',
            filters: { attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'], action: 'include' },
          }),
        },
        5000,
      );
      const limits = parseTraceSpeedLimits(body, r.geometry.length);
      if (limits.length) r.speedLimits = limits;
    } catch {
      /* limitations facultatives */
    }
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    const body = await call('valhalla', this.fetchFn, this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(this.requestBody(req)),
    });
    if (!isObj(body)) throw new RouteProviderError('valhalla', 'réponse inattendue');
    const main = parseValhallaTrip(body.trip);
    const alts: RouteOption[] = [];
    for (const a of Array.isArray(body.alternates) ? body.alternates.filter(isObj) : []) {
      try {
        alts.push(parseValhallaTrip(a.trip));
      } catch {
        /* alternative inexploitable ignorée */
      }
    }
    const routes = sortFastest([main, ...alts]).slice(0, 3);
    await Promise.all(routes.map((r) => this.speedLimits(r)));
    return result('valhalla', routes, req.options, '© contributeurs OpenStreetMap, Valhalla');
  }
}

// ---------------------------------------------------------------- Repli

/**
 * TomTom d'abord ; en cas de panne (RouteProviderError : HTTP 5xx, délai, réponse inexploitable), repli Valhalla
 * `traffic:false`. Le repli n'existe que si une instance Valhalla est autorisée par la configuration (en production,
 * jamais le serveur public FOSSGIS : VALHALLA_URL explicite requise, voir config.ts).
 */
export class FallbackRouteProvider implements RouteProvider {
  readonly name: RouteResult['provider'];

  constructor(
    private readonly primary: RouteProvider,
    private readonly fallback: RouteProvider,
    private readonly onFallback?: (err: RouteProviderError) => void,
  ) {
    this.name = primary.name;
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    try {
      return await this.primary.route(req);
    } catch (err) {
      if (!(err instanceof RouteProviderError)) throw err;
      this.onFallback?.(err);
      return this.fallback.route(req);
    }
  }
}
