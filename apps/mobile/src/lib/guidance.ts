// Logique de guidage pure (testée) : annonces vocales, limitation, trajet plus rapide, trafic, batterie, bornes sur le trajet.
import { metersBetween, progressOnRoute, type LonLat, type Maneuver, type RouteOption, type RouteStep } from './navigation';
import type { Station } from './stations';
import { lang, tr } from '../i18n';
import { bigDist as bigDistFmt, etaClock as etaClockFmt, spokenDist as spokenDistFmt } from '../i18n/format';

// ---------------------------------------------------------------- Distances et textes

/** Distance affichée à l'écran : arrondis de lecture rapide (comme Waze). */
export const bigDist = bigDistFmt;

/** Distance lue par la voix (« 1,5 kilomètre », « 300 mètres »). */
export const spokenDist = spokenDistFmt;

export const etaClock = etaClockFmt;

/** Écart affiché entre un trajet et le plus rapide (« +6 min », « même durée »). */
export function deltaText(s: number): string {
  const m = Math.round(s / 60);
  return m <= 0 ? tr().trip.same : tr().trip.delta(m);
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

/** Consigne d'une étape dans la langue courante : texte du fournisseur en français, sinon générée depuis la manœuvre. */
export function instructionOf(step: RouteStep): string {
  if (lang() === 'fr' && step.instruction) return step.instruction;
  return tr().instr[maneuverOf(step)]({ street: step.street, towards: step.towards, exit: step.exit, exitNumber: step.exitNumber });
}

/** Texte de l'annonce, avec enchaînement « puis… » si la manœuvre suivante est très proche. */
export function announcementText(level: AnnounceLevel, inM: number, step: RouteStep, then?: { step: RouteStep; gapM: number }): string {
  const v = tr().voice;
  const what = instructionOf(step).replace(/\.$/, '');
  const base = level === 'near' ? what : v.inDist(spokenDist(inM), what);
  if (then && then.gapM < 150 && maneuverOf(then.step) !== 'arrive' && maneuverOf(then.step) !== 'waypoint') return v.then(base, instructionOf(then.step).replace(/\.$/, ''));
  return `${base}.`;
}

/**
 * Annonce vocale d'une étape au niveau `level`, ou null. Arrivée et étape (waypoint) : seulement « Dans X, … »,
 * jamais au niveau proche — l'arrivée à l'étape et à destination a sa propre annonce (pas de double annonce).
 */
export function maneuverVoice(level: AnnounceLevel, inM: number, step: RouteStep, then?: { step: RouteStep; gapM: number }): string | null {
  const m = maneuverOf(step);
  if (m === 'arrive' || m === 'waypoint') {
    if (level === 'near') return null;
    return m === 'arrive' ? tr().voice.arrivingIn(spokenDist(inM)) : tr().navx.viaInVoice(spokenDist(inM));
  }
  return announcementText(level, inM, step, then);
}

// ---------------------------------------------------------------- Guidage : mise en page et caméra

/** Paysage : largeur du bandeau de guidage à gauche (la carte occupe le reste, à droite). 0 en portrait. */
export const guidanceSide = (width: number, height: number) => (width > height ? Math.min(420, Math.max(300, Math.round(width * 0.42))) : 0);

/** Colonne des boutons ronds (voix, signaler, partager) à droite de la carte : 56 px + marges. */
export const GUIDANCE_ACTIONS_W = 80;

/**
 * Décalage de la caméra en guidage (px, centre de la carte → position du véhicule). Vertical : véhicule plus bas
 * (plus de route devant). Ordinateur / grand écran (≥ 768 px) : centré horizontalement dans la zone libre de la carte,
 * à gauche de la colonne de boutons (le tracé ne passe pas sous les boutons). En paysage, la carte commence déjà
 * à droite du bandeau (app/index.tsx : left = guidanceSide), d'où un décalage d'une demi-colonne seulement.
 */
export function followOffsetFor(width: number, height: number): { x: number; y: number } {
  const y = width > height ? Math.round(height * 0.18) : 150;
  const x = width >= 768 ? -Math.round(GUIDANCE_ACTIONS_W / 2) : 0;
  return { x, y };
}

// ---------------------------------------------------------------- Guidage : états

/** Tracé de la proposition de trajet plus rapide, affiché sur la carte jusqu'à la décision (« −X min »). */
export const OFFER_ROUTE_ID = '__offer';
/** Tronçon déjà parcouru (gris, sous le tracé). */
export const DONE_ROUTE_ID = '__done';

/** Tolérance d'écart au tracé (m), précision GPS comprise : hors trajet au-delà. */
export const routeTolerance = (accuracy: number | null | undefined) => Math.max(45, Math.min(accuracy ?? 20, 60) + 30);

/** Ligne coupée à la projection de `p` (le reste du tracé, depuis la position). */
export function lineFrom(line: LonLat[], p: { lat: number; lon: number }): LonLat[] {
  if (line.length < 2) return line;
  const { seg } = progressOnRoute(p, line);
  const a = line[seg]!, b = line[seg + 1]!;
  const k = Math.cos((p.lat * Math.PI) / 180);
  const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.lon - a[0]) * k * dx + (p.lat - a[1]) * dy) / len2)) : 0;
  const here: LonLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const rest = line.slice(seg + 1);
  return rest.length ? [here, ...rest] : [here, b];
}

/**
 * Tracé proposé sur la carte (« −X min ») jusqu'à la décision, coupé à la position actuelle `from` (seul le trajet
 * à venir est dessiné, jamais la partie déjà dépassée).
 */
export function offerAlt(
  offer: { route: Pick<RouteOption, 'geometry'>; gainS: number } | null | undefined,
  from?: { lat: number; lon: number } | null,
): { id: string; coords: LonLat[]; label: string }[] {
  if (!offer || offer.route.geometry.length < 2) return [];
  const coords = from ? lineFrom(offer.route.geometry, from) : offer.route.geometry;
  if (coords.length < 2) return [];
  return [{ id: OFFER_ROUTE_ID, coords, label: tr().navx.gainLabel(Math.max(1, Math.round(offer.gainS / 60))) }];
}

/**
 * Proposition toujours valable à cette position ? Le conducteur doit être sur le trajet proposé (écart < tolérance) :
 * sinon (bifurcation dépassée) l'offre est retirée sans annonce. Position trop imprécise (> 100 m) : pas de verdict.
 */
export function offerStillValid(p: { lat: number; lon: number; accuracy?: number | null }, offer: { route: Pick<RouteOption, 'geometry'> }): boolean {
  if ((p.accuracy ?? 0) > 100) return true;
  if (offer.route.geometry.length < 2) return false;
  return progressOnRoute(p, offer.route.geometry).off < routeTolerance(p.accuracy);
}

/** Bascule du fournisseur en cours de guidage : TomTom (trafic) → Valhalla (sans trafic) = toast d'avertissement. */
export function lostTraffic(prev: { provider: string | null; traffic: boolean }, next: { provider: string | null; traffic: boolean }): boolean {
  return prev.provider === 'tomtom' && prev.traffic && next.provider !== 'tomtom' && !next.traffic;
}

/**
 * Batterie de départ après une étape : niveau déclaré après une recharge, sinon l'estimation courante.
 * Sans recharge déclarée, la batterie ne remonte jamais (pas de retour au niveau saisi au départ).
 */
export function socAfterStop(estimate: number, declared?: number | null): number {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  if (typeof declared === 'number' && Number.isFinite(declared)) return clamp(Math.round(declared));
  return clamp(estimate);
}

/** Choix proposés à l'étape (batterie après la recharge, en %). */
export const SOC_CHOICES = [50, 60, 70, 80, 90, 100] as const;

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

/** Segments colorés restant à parcourir (le tronçon parcouru n'est plus coloré). */
export function trafficSegmentsFrom(route: Pick<RouteOption, 'geometry' | 'trafficSections'>, seg: number): { coords: LonLat[]; level: TrafficLevel }[] {
  return trafficSegments({
    geometry: route.geometry,
    trafficSections: route.trafficSections.filter((s) => s.endIndex > seg).map((s) => ({ ...s, startIndex: Math.max(s.startIndex, seg) })),
  });
}

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

export interface FreshCheck {
  /** Le trajet suivi, recalculé depuis la position (durée et trafic frais), s'il figure dans la réponse. */
  same: RouteOption | null;
  /** Trajet nettement plus rapide que le trajet suivi recalculé. */
  faster: { route: RouteOption; gainS: number } | null;
}

/**
 * Vérification périodique : `fresh` = trajets recalculés depuis la position (le plus rapide d'abord).
 * Référence = le trajet suivi recalculé (même trafic), sinon l'estimation restante.
 * `declined` : tracé déjà refusé par le conducteur (re-proposé seulement si le gain progresse de 3 min).
 */
export function checkFresh(
  currentRest: LonLat[],
  currentRemainingS: number,
  fresh: RouteOption[],
  declined?: { geometry: LonLat[]; gainS: number } | null,
): FreshCheck {
  const same = fresh.find((r) => sameRoute(currentRest, r.geometry)) ?? null;
  const ref = same ? same.durationS : currentRemainingS;
  const best = fresh.filter((r) => r !== same).sort((a, b) => a.durationS - b.durationS)[0];
  if (!best) return { same, faster: null };
  const gainS = ref - best.durationS;
  if (gainS < FASTER_MIN_GAIN_S) return { same, faster: null };
  if (declined && sameRoute(declined.geometry, best.geometry, 60) && gainS < declined.gainS + 180) return { same, faster: null };
  return { same, faster: { route: best, gainS } };
}

/** Choix par défaut à la fin du décompte : garder si le conducteur avait choisi une alternative, prendre sinon. */
export const offerDefault = (driverChose: boolean): 'take' | 'keep' => (driverChose ? 'keep' : 'take');

/** Reporte les annonces déjà faites sur les étapes équivalentes (même point à 25 m) d'un trajet rafraîchi. */
export function remapAnnounced(oldSteps: RouteStep[], newSteps: RouteStep[], done: Set<string>): Set<string> {
  const out = new Set<string>([...done].filter((k) => !/^s\d+:/.test(k)));
  newSteps.forEach((n, j) => {
    const i = oldSteps.findIndex((o) => maneuverOf(o) === maneuverOf(n) && metersBetween(o, n) < 25);
    if (i < 0) return;
    for (const l of ['far', 'mid', 'near']) if (done.has(`s${i}:${l}`)) out.add(`s${j}:${l}`);
  });
  return out;
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

/** Batterie actuelle estimée (%) : niveau saisi au départ moins la consommation de la distance parcourue. */
export function socNowEstimate(v: VehicleLike, socAfter: (v: VehicleLike, soc: number, m: number) => number, drivenM: number, avgKmh: number): number {
  return socAfter(v, v.socPercent, drivenM * (avgKmh > 110 ? 1.15 : 1.05));
}

/**
 * Batterie à l'arrivée en guidage = batterie actuelle estimée − consommation du reste du trajet (marge comprise),
 * jamais remontante d'une position à l'autre (`prev`), arrondie.
 */
export function liveArrivalSoc(
  v: VehicleLike,
  socAfter: (v: VehicleLike, soc: number, m: number) => number,
  socNow: number,
  remainingM: number,
  remainingS: number,
  prev: number | null,
): number {
  const avg = remainingS > 0 ? remainingM / 1000 / (remainingS / 3600) : 0;
  const x = Math.round(socAfter(v, socNow, remainingM * (avg > 110 ? 1.15 : 1.05)));
  return prev === null ? x : Math.min(prev, x);
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
