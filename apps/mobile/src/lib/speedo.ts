// Compteur de vitesse (guidage et carte) : visibilité, fraîcheur de la mesure, dépassement lissé, limitation hors guidage.
// Pur (sans react-native) : testé sous Node (speedo.test.ts). Tous les calculs en km/h ; l'affichage convertit (i18n/format).
import { isOverSpeed, speedLimitAt } from './guidance';
import { progressOnRoute, type RouteOption } from './navigation';

/** Dépassement retenu au-delà de limite + 3 km/h (tolérance de lecture, voir isOverSpeed). */
export const OVER_MARGIN_KMH = 3;
/** Une bascule (normal ↔ dépassement) n'est prise qu'après 2 s continues dans le nouvel état : pas de clignotement. */
export const OVER_HOLD_MS = 2000;
/** Hors guidage, le compteur apparaît dès 5 km/h… */
export const MOVING_KMH = 5;
/** …et reste 20 s après l'arrêt (feu rouge, bouchon). */
export const LINGER_MS = 20_000;
/** Aucune position depuis 5 s : vitesse inconnue (le suivi natif n'envoie rien à l'arrêt). */
export const STALE_MS = 5000;
/** Limitation hors guidage : seulement si l'on roule sur la dernière route calculée (à 30 m près). */
export const ON_ROUTE_M = 30;

export interface OverState {
  over: boolean;
  /** Instant où la mesure a commencé à contredire `over` (null : en accord). */
  since: number | null;
}
export const OVER_IDLE: OverState = { over: false, since: null };

/**
 * Dépassement lissé : passe au rouge après 2 s au-dessus du seuil ; revient à la normale après 2 s sous le seuil,
 * ou tout de suite une fois sous la limitation elle-même (ou si vitesse/limitation deviennent inconnues).
 */
export function stepOver(s: OverState, speedKmh: number | null, limitKmh: number | null, now: number): OverState {
  const raw = isOverSpeed(speedKmh, limitKmh);
  if (raw === s.over) return s.since === null ? s : { over: s.over, since: null };
  if (s.over && (speedKmh === null || limitKmh === null || speedKmh <= limitKmh)) return OVER_IDLE;
  if (s.since === null) return { over: s.over, since: now };
  return now - s.since >= OVER_HOLD_MS ? { over: raw, since: null } : s;
}

export interface SpeedoState {
  over: OverState;
  /** Dernier instant où l'on roulait (≥ 5 km/h). */
  movingAt: number | null;
}
export const SPEEDO_IDLE: SpeedoState = { over: OVER_IDLE, movingAt: null };

export interface SpeedoInput {
  /** Vitesse mesurée (km/h) à la dernière position. */
  kmh: number | null;
  /** Réception de cette position (horloge de l'appareil), null si aucune. */
  receivedAt: number | null;
  limitKmh: number | null;
  /** En guidage, le compteur est toujours affiché. */
  guiding: boolean;
}

export interface SpeedoView {
  show: boolean;
  /** Vitesse affichée (null : inconnue ou mesure trop ancienne). */
  kmh: number | null;
  over: boolean;
}

/** Un pas du compteur (à chaque position et à chaque battement d'horloge). */
export function stepSpeedo(s: SpeedoState, i: SpeedoInput, now: number): { state: SpeedoState; view: SpeedoView } {
  const fresh = i.receivedAt !== null && now - i.receivedAt <= STALE_MS;
  const kmh = fresh && typeof i.kmh === 'number' && Number.isFinite(i.kmh) && i.kmh >= 0 ? i.kmh : null;
  const movingAt = kmh !== null && kmh >= MOVING_KMH ? now : s.movingAt;
  const over = stepOver(s.over, kmh, i.limitKmh, now);
  const show = i.guiding || (movingAt !== null && now - movingAt <= LINGER_MS);
  const state = over === s.over && movingAt === s.movingAt ? s : { over, movingAt };
  return { state, view: { show, kmh, over: over.over } };
}

/** Limitation à la position sur un tracé déjà calculé (hors guidage), si l'on est dessus et qu'elle est connue. */
export function limitNear(route: Pick<RouteOption, 'geometry' | 'speedLimits'> | null, p: { lat: number; lon: number } | null, maxOffM = ON_ROUTE_M): number | null {
  if (!route || !p || !route.speedLimits?.length || route.geometry.length < 2) return null;
  const prog = progressOnRoute(p, route.geometry);
  return prog.off <= maxOffM ? speedLimitAt(route, prog.seg) : null;
}
