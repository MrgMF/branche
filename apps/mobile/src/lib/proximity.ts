// Détection « Vous êtes à X » : station chargée la plus proche à moins de 60 m — fonction pure (proximity.test.ts).
import { distanceKm, type Station } from './stations';

export const ARRIVAL_RADIUS_M = 60;

export function nearbyStation(list: Station[], pos: { lat: number; lon: number } | null, maxM = ARRIVAL_RADIUS_M): { station: Station; distanceM: number } | null {
  if (!pos) return null;
  let best: { station: Station; distanceM: number } | null = null;
  for (const s of list) {
    // Pré-filtre rapide (~0,001° ≈ 110 m) avant le calcul exact
    if (Math.abs(s.lat - pos.lat) > 0.002 || Math.abs(s.lon - pos.lon) > 0.003) continue;
    const d = distanceKm(pos, s) * 1000;
    if (d <= maxM && (!best || d < best.distanceM)) best = { station: s, distanceM: Math.round(d) };
  }
  return best;
}
