// Logique de guidage pure (testée) : annonces vocales, limitation, trajet plus rapide, trafic, batterie, bornes sur le trajet.
import { metersBetween, progressOnRoute, type LonLat, type Maneuver, type RouteOption, type RouteStep } from './navigation';
import type { Station } from './stations';

// ---------------------------------------------------------------- Distances et textes

/** Distance affichée à l'écran : arrondis de lecture rapide (comme Waze). */
export function bigDist(m: number): { value: string; unit: string } {
  if (m >= 10000) return { value: String(Math.round(m / 1000)), unit: 'km' };
  if (m >= 1000) return { value: (Math.round(m / 100) / 10).toLocaleString('fr-FR'), unit: 'km' };
  if (m >= 300) return { value: String(Math.round(m / 50) * 50), unit: 'm' };
  return { value: String(Math.max(0, Math.round(m / 10) * 10)), unit: 'm' };
}

/** Distance lue par la voix (« 1,5 kilomètre », « 300 mètres »). */
export function spokenDist(m: number): string {
  if (m >= 950) {
    const km = Math.round(m / 500) / 2;
    return `${km.toLocaleString('fr-FR')} kilomètre${km >= 2 ? 's' : ''}`;
  }
  const r = m >= 200 ? Math.round(m / 100) * 100 : Math.max(10, Math.round(m / 10) * 10);
  return `${r} mètres`;
}

export const etaClock = (seconds: number, now = Date.now()) =>
  new Date(now + seconds * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Écart affiché entre un trajet et le plus rapide (« +6 min », « même durée »). */
export function deltaText(s: number): string {
  const m = Math.round(s / 60);
  return m <= 0 ? 'Même durée' : `+${m} min`;
}

// ---------------------------------------------------------------- Étapes

export const maneuverOf = (s: Pick<RouteStep, 'maneuver'>): Maneuver => s.maneuver ?? 'straight';

/** Abscisse de chaque étape le long du trajet (m) : offsetM de l'API, sinon projection. */
export function stepsAlong(route: Pick<RouteOption, 'steps' | 'geometry'>): number[] {
  return route.steps.map((s) => (typeof s.offsetM === 'number' ? s.offsetM : progressOnRoute(s, route.geometry).along));
}

/** Prochaine manœuvre (hors départ) au-delà de la position. */
export function nextStepIndex(along: number[], steps: RouteStep[], pos: number): number {
  for (let i = 0; i < steps.length; i++) {
    if (maneuverOf(steps[i]) === 'depart') continue;
    if (along[i] > pos + 8) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- Annonces vocales

export type AnnounceLevel = 'far' | 'mid' | 'near';

/** Seuils d'annonce (m) selon la vitesse : ≈ 1500/500/100 m sur voie rapide, plus courts en ville. */
export function announceThresholds(speedKmh: number | null): Record<AnnounceLevel, number> {
  const v = speedKmh ?? 50;
  if (v >= 75) return { far: 1500, mid: 500, near: 120 };
  if (v >= 40) return { far: 800, mid: 300, near: 70 };
  return { far: 400, mid: 150, near: 40 };
}

/**
 * Annonce à faire maintenant pour l'étape `idx`, ou null. `done` : clés déjà annoncées (mutée).
 * `legM` = longueur du tronçon qui mène à la manœuvre : pas d'annonce « lointaine » sur un tronçon court.
 */
export function pickAnnouncement(idx: number, inM: number, legM: number, speedKmh: number | null, done: Set<string>): AnnounceLevel | null {
  const t = announceThresholds(speedKmh);
  const levels: AnnounceLevel[] = ['near', 'mid', 'far'];
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (inM > t[level]) continue;
    if (done.has(`s${idx}:${level}`)) return null;
    // Niveau atteint : lui et les niveaux plus lointains ne seront plus dits ; les plus proches restent à venir.
    for (const l of levels.slice(i)) done.add(`s${idx}:${l}`);
    // Tronçon bien plus court que la distance d'annonce : la manœuvre a déjà été chaînée (« puis… »).
    if (level !== 'near' && legM < t[level] * 0.5) return null;
    return level;
  }
  return null;
}

/** Texte de l'annonce, avec enchaînement « puis… » si la manœuvre suivante est très proche. */
export function announcementText(level: AnnounceLevel, inM: number, step: RouteStep, then?: { step: RouteStep; gapM: number }): string {
  const what = step.instruction.replace(/\.$/, '');
  const lower = what.charAt(0).toLowerCase() + what.slice(1);
  const base = level === 'near' ? what : `Dans ${spokenDist(inM)}, ${lower}`;
  if (then && then.gapM < 150 && maneuverOf(then.step) !== 'arrive') {
    const t = then.step.instruction.replace(/\.$/, '');
    return `${base}, puis ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
  }
  return `${base}.`;
}

// ---------------------------------------------------------------- Vitesse

/** Limitation de vitesse au segment `seg` de la géométrie, si fournie. */
export function speedLimitAt(route: Pick<RouteOption, 'speedLimits'>, seg: number): number | null {
  for (const s of route.speedLimits ?? []) {
    if (seg >= s.startIndex && (seg < s.endIndex || (s.startIndex === s.endIndex && seg === s.startIndex))) return s.kmh;
  }
  return null;
}

/** Dépassement : tolérance de 3 km/h (lecture du compteur), affichage seulement. */
export const isOverSpeed = (speedKmh: number | null, limitKmh: number | null) => speedKmh !== null && limitKmh !== null && speedKmh > limitKmh + 3;

/** Vitesse (km/h) : coords.speed si fourni (m/s), sinon dérivée des deux dernières positions. */
export function speedKmh(coordsSpeed: number | null | undefined, prev: { lat: number; lon: number; t: number } | null, cur: { lat: number; lon: number; t: number }): number | null {
  if (typeof coordsSpeed === 'number' && coordsSpeed >= 0 && Number.isFinite(coordsSpeed)) return coordsSpeed * 3.6;
  if (!prev) return null;
  const dt = (cur.t - prev.t) / 1000;
  if (dt < 0.5 || dt > 30) return null;
  const v = (metersBetween(prev, cur) / dt) * 3.6;
  return v < 250 ? v : null;
}

// ---------------------------------------------------------------- Trafic (tracé coloré)

export type TrafficLevel = 'slow' | 'jam' | 'closed';
export const trafficLevel = (magnitude: number): TrafficLevel | null =>
  magnitude >= 4 ? 'closed' : magnitude === 3 ? 'jam' : magnitude >= 1 ? 'slow' : null;

/** Segments colorés à superposer au tracé principal. */
export function trafficSegments(route: Pick<RouteOption, 'geometry' | 'trafficSections'>): { coords: LonLat[]; level: TrafficLevel }[] {
  const out: { coords: LonLat[]; level: TrafficLevel }[] = [];
  for (const s of route.trafficSections) {
    const level = trafficLevel(s.magnitude) ?? (s.delayS > 60 ? 'slow' : null);
    if (!level) continue;
    const coords = route.geometry.slice(s.startIndex, Math.max(s.startIndex + 2, s.endIndex + 1));
    if (coords.length >= 2) out.push({ coords, level });
  }
  return out;
}

// ---------------------------------------------------------------- Trajet plus rapide

/** Échantillonne une ligne tous les `stepM` mètres (au plus `max` points). */
export function sample(line: LonLat[], stepM = 250, max = 40): LonLat[] {
  const out: LonLat[] = [];
  if (!line.length) return out;
  out.push(line[0]);
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += metersBetween({ lon: line[i - 1][0], lat: line[i - 1][1] }, { lon: line[i][0], lat: line[i][1] });
    if (acc >= stepM) {
      out.push(line[i]);
      acc = 0;
    }
  }
  if (out.length > max) {
    const k = out.length / max;
    return Array.from({ length: max }, (_, i) => out[Math.floor(i * k)]);
  }
  return out;
}

/** Deux tracés empruntent-ils la même route ? (≥ 90 % des points de `b` à moins de 40 m de `a`) */
export function sameRoute(a: LonLat[], b: LonLat[], tolM = 40): boolean {
  const pts = sample(b);
  if (!pts.length || a.length < 2) return false;
  const near = pts.filter(([lon, lat]) => progressOnRoute({ lon, lat }, a).off <= tolM).length;
  return near / pts.length >= 0.9;
}

/** Partie restante d'un tracé depuis le segment `seg`. */
export const remainingLine = (line: LonLat[], seg: number, pos: { lat: number; lon: number }): LonLat[] => [[pos.lon, pos.lat], ...line.slice(seg + 1)];

export const FASTER_MIN_GAIN_S = 180;

/**
 * Faut-il basculer ? `fresh` : trajets recalculés depuis la position actuelle (le plus rapide d'abord).
 * Référence : le trajet actuel recalculé s'il est dans la réponse (même trafic), sinon l'estimation restante.
 */
export function fasterRoute(currentRest: LonLat[], currentRemainingS: number, fresh: RouteOption[]): { route: RouteOption; gainS: number } | null {
  const best = fresh[0];
  if (!best) return null;
  if (sameRoute(currentRest, best.geometry)) return null;
  const same = fresh.find((r) => sameRoute(currentRest, r.geometry));
  const ref = same ? same.durationS : currentRemainingS;
  const gainS = ref - best.durationS;
  return gainS >= FASTER_MIN_GAIN_S ? { route: best, gainS } : null;
}

// ---------------------------------------------------------------- VE

export interface VehicleLike {
  name: string;
  batteryKWh: number;
  consumptionKWhPer100: number;
  socPercent: number;
  plugs: string[];
}

/** Batterie estimée à l'arrivée (%) avec marge : +5 %, +15 % si moyenne > 110 km/h (autoroute). */
export function arrivalSoc(v: VehicleLike, socAfter: (v: VehicleLike, soc: number, m: number) => number, distanceM: number, durationS: number): number {
  const avgKmh = durationS > 0 ? distanceM / 1000 / (durationS / 3600) : 0;
  const factor = avgKmh > 110 ? 1.15 : 1.05;
  return Math.round(socAfter(v, v.socPercent, distanceM * factor));
}

export const LOW_SOC = 10;
export const FAST_KW = 50;

export interface ChargerSuggestion {
  station: Station;
  alongM: number;
  offM: number;
  /** Batterie estimée en arrivant à la borne (%). */
  socAt: number;
}

/**
 * Bornes rapides (≥ 50 kW, prise compatible, accès libre) à moins de 2 km du tracé, atteignables avec
 * au moins 8 % de batterie ; on garde les plus lointaines (moins d'arrêts) puis les plus proches du tracé.
 */
export function chargersOnRoute(
  stations: Station[],
  line: LonLat[],
  v: VehicleLike,
  socAfter: (v: VehicleLike, soc: number, m: number) => number,
  totalM: number,
  max = 3,
): ChargerSuggestion[] {
  const out: ChargerSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of stations) {
    if (seen.has(s.id) || s.kw < FAST_KW || s.acc === 'reserve') continue;
    if (s.c.length && !s.c.some((p) => v.plugs.includes(p))) continue;
    const { off, along } = progressOnRoute(s, line);
    if (off > 2000 || along > totalM - 1000) continue;
    const socAt = Math.round(socAfter(v, v.socPercent, (along + off * 2) * 1.1));
    if (socAt < 8) continue;
    seen.add(s.id);
    out.push({ station: s, alongM: along, offM: off, socAt });
  }
  return out.sort((a, b) => b.alongM - a.alongM || a.offM - b.offM).slice(0, max);
}

/** Points d'échantillonnage (tous les ~20 km) pour charger les tuiles de bornes le long du tracé. */
export const tileProbes = (line: LonLat[]) => sample(line, 20000, 30).map(([lon, lat]) => ({ lon, lat }));
