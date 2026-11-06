// Parseur Valhalla (réponse /route) : COPIE CONFORME de apps/api/src/navigation/route.ts (parseValhallaTrip et
// utilitaires), sans dépendance, pour le repli client du site statique (aucun serveur Branché).
// Parité vérifiée par apps/api/test/valhalla-parity.test.ts : toute modification doit être faite des deux côtés.

export type VhManeuver =
  | 'depart' | 'straight' | 'turn-left' | 'turn-right' | 'slight-left' | 'slight-right' | 'sharp-left' | 'sharp-right'
  | 'uturn' | 'roundabout' | 'exit-left' | 'exit-right' | 'keep-left' | 'keep-right' | 'merge' | 'ramp' | 'ferry' | 'waypoint' | 'arrive';
export type VhLaneDir =
  | 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'uturn-left' | 'slight-right' | 'right' | 'sharp-right' | 'uturn-right' | 'merge-left' | 'merge-right';

export interface VhStep {
  instruction: string;
  distanceM: number;
  lon: number;
  lat: number;
  maneuver: VhManeuver;
  street?: string;
  exit?: number;
  exitNumber?: string;
  towards?: string;
  angle?: number;
  offsetM: number;
  pointIndex: number;
  lanes?: { directions: VhLaneDir[]; active: boolean }[];
}

export interface VhOption {
  id: string;
  durationS: number;
  trafficDelayS: number;
  distanceM: number;
  hasTolls: boolean;
  hasMotorways: boolean;
  geometry: [number, number][];
  steps: VhStep[];
  trafficSections: { startIndex: number; endIndex: number; delayS: number; magnitude: number }[];
}

export class ValhallaParseError extends Error {
  constructor(public readonly reason: string) {
    super(`valhalla: ${reason}`);
    this.name = 'ValhallaParseError';
  }
}

const round = (x: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
};
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
const coord = (lon: number, lat: number): [number, number] => [round(lon, 6), round(lat, 6)];
const normAngle = (a: number) => {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return Math.round(x);
};
const ordinal = (n: number) => (n === 1 ? '1re' : `${n}e`);

/** Consigne française générée (identique à instructionFr de l'API). */
export function instructionFr(s: Pick<VhStep, 'maneuver' | 'street' | 'exit' | 'exitNumber' | 'towards'>): string {
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
    case 'ramp':
      return `Prenez la bretelle${toward || onto}`;
    case 'ferry':
      return `Prenez le bac${onto}`;
    case 'waypoint':
      return 'Vous avez atteint votre étape';
    case 'arrive':
      return 'Vous êtes arrivé à destination';
  }
}

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

const VALHALLA_MANEUVER: Record<number, VhManeuver> = {
  1: 'depart', 2: 'depart', 3: 'depart', 4: 'arrive', 5: 'arrive', 6: 'arrive', 7: 'straight', 8: 'straight', 9: 'slight-right',
  10: 'turn-right', 11: 'sharp-right', 12: 'uturn', 13: 'uturn', 14: 'sharp-left', 15: 'turn-left', 16: 'slight-left',
  // 17 kRampStraight, 18 kRampRight, 19 kRampLeft : bretelle (l'angle fixe le côté de l'icône).
  17: 'ramp', 18: 'ramp', 19: 'ramp', 20: 'exit-right', 21: 'exit-left', 22: 'straight', 23: 'keep-right', 24: 'keep-left', 25: 'merge',
  26: 'roundabout', 28: 'ferry', 29: 'straight', 37: 'merge', 38: 'merge',
};
const valhallaManeuver = (t: unknown): VhManeuver => (typeof t === 'number' && VALHALLA_MANEUVER[t]) || 'straight';

const VALHALLA_LANE_BITS: [number, VhLaneDir][] = [
  [2, 'straight'], [4, 'sharp-left'], [8, 'left'], [16, 'slight-left'], [32, 'slight-right'], [64, 'right'], [128, 'sharp-right'],
  [256, 'uturn-left'], [512, 'merge-left'], [1024, 'merge-right'],
];
const valhallaLaneDirs = (mask: number): VhLaneDir[] => VALHALLA_LANE_BITS.filter(([bit]) => (mask & bit) !== 0).map(([, d]) => d);

const names = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && !!s.trim()).map(clean) : []);
const signText = (sign: unknown, key: string) =>
  isObj(sign) && Array.isArray(sign[key])
    ? sign[key]
        .filter(isObj)
        .map((e) => (typeof e.text === 'string' ? clean(e.text) : ''))
        .filter(Boolean)
        .join(' / ') || undefined
    : undefined;

/** Un `trip` Valhalla → option normalisée (même sortie que l'API). */
export function parseValhallaTrip(trip: unknown): VhOption {
  if (!isObj(trip) || !isObj(trip.summary) || !Array.isArray(trip.legs)) throw new ValhallaParseError('réponse inattendue');
  if (trip.status !== undefined && trip.status !== 0) throw new ValhallaParseError(`statut ${String(trip.status)}`);
  const time = num(trip.summary.time);
  const lengthKm = num(trip.summary.length);
  if (time === null || lengthKm === null) throw new ValhallaParseError('résumé manquant');

  const geometry: [number, number][] = [];
  const steps: VhStep[] = [];
  let offsetM = 0;
  const legs = trip.legs.filter(isObj);
  legs.forEach((leg, legIdx) => {
    if (typeof leg.shape !== 'string') return;
    const shape = decodePolyline(leg.shape, 6).map(([lon, lat]) => coord(lon, lat));
    const base = geometry.length > 0 ? geometry.length - 1 : 0;
    geometry.push(...(geometry.length > 0 ? shape.slice(1) : shape));
    const maneuvers = Array.isArray(leg.maneuvers) ? leg.maneuvers.filter(isObj) : [];
    const last = legIdx === legs.length - 1;
    for (let k = 0; k < maneuvers.length; k++) {
      const m = maneuvers[k]!;
      const type = num(m.type) ?? 0;
      const lenM = Math.round((num(m.length) ?? 0) * 1000);
      if (type === 27) {
        const prev = steps[steps.length - 1];
        if (prev?.maneuver === 'roundabout') prev.distanceM += lenM;
        offsetM += lenM;
        continue;
      }
      let maneuver = valhallaManeuver(type);
      if (legIdx > 0 && maneuver === 'depart') {
        offsetM += lenM;
        continue;
      }
      if (maneuver === 'arrive' && !last) maneuver = 'waypoint';
      const local = Math.min(Math.max(0, num(m.begin_shape_index) ?? 0), Math.max(0, shape.length - 1));
      const p = shape[local];
      if (!p) continue;
      const step: VhStep = { instruction: '', distanceM: lenM, lon: p[0], lat: p[1], maneuver, offsetM: Math.round(offsetM), pointIndex: base + local };
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
          return { directions: dirs.length ? dirs : (['straight'] as VhLaneDir[]), active: (num(l.active) ?? 0) !== 0 || (num(l.valid) ?? 0) !== 0 };
        });
        if (lanes.length > 0 && lanes.length <= 12) step.lanes = lanes;
      }
      step.instruction = typeof m.instruction === 'string' && m.instruction.trim() ? clean(m.instruction) : instructionFr(step);
      steps.push(step);
      offsetM += lenM;
    }
  });
  if (geometry.length < 2) throw new ValhallaParseError('géométrie vide');
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

/** Corps de requête /route (identique à ValhallaRouteProvider.requestBody de l'API). */
export function valhallaRequestBody(req: {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  via: { lat: number; lon: number }[];
  options: { avoidTolls: boolean; avoidMotorways: boolean };
}): Record<string, unknown> {
  const loc = (p: { lat: number; lon: number }) => ({ lat: round(p.lat, 6), lon: round(p.lon, 6) });
  return {
    locations: [loc(req.from), ...req.via.map((v) => ({ ...loc(v), type: 'break' })), loc(req.to)],
    costing: 'auto',
    costing_options: { auto: { use_tolls: req.options.avoidTolls ? 0 : 0.5, use_highways: req.options.avoidMotorways ? 0 : 1 } },
    ...(req.via.length ? {} : { alternates: 2 }),
    units: 'kilometers',
    language: 'fr-FR',
    directions_type: 'instructions',
    turn_lanes: true,
  };
}

/** Réponse /route complète → trajets triés (le plus rapide d'abord, au plus 3), ids r0… */
export function parseValhallaResponse(body: unknown): VhOption[] {
  if (!isObj(body)) throw new ValhallaParseError('réponse inattendue');
  const main = parseValhallaTrip(body.trip);
  const alts: VhOption[] = [];
  for (const a of Array.isArray(body.alternates) ? body.alternates.filter(isObj) : []) {
    try {
      alts.push(parseValhallaTrip(a.trip));
    } catch {
      /* alternative inexploitable ignorée */
    }
  }
  return [main, ...alts]
    .sort((a, b) => a.durationS - b.durationS)
    .slice(0, 3)
    .map((r, i) => ({ ...r, id: `r${i}` }));
}
