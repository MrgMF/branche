// Borne libre la plus proche d'un point (borne hors service, bandeau « Vous êtes à ») : disponibilité temps réel, accès public.
import { getAvailability, stationSummary } from './availability';
import { nearest, type Station } from './stations';

type Pos = { lat: number; lon: number };

/** Station entièrement hors service selon le temps réel (tous les points connus et tous hors service). */
export const allDown = (sum: { down: number; known: number; total: number }) => sum.total > 0 && sum.known === sum.total && sum.down === sum.total;

/** Plus proche station publique avec au moins un point signalé libre (parmi les 12 plus proches), sinon null. */
export async function nearestFree(from: Pos, list: Station[], excludeId?: string): Promise<{ s: Station; d: number } | null> {
  const cands = nearest(
    list.filter((s) => s.id !== excludeId && s.acc !== 'reserve'),
    from,
    12,
  );
  if (!cands.length) return null;
  const items = await getAvailability(cands.flatMap(({ s }) => (s.pdc ?? []).map(([id]) => id)));
  return cands.find(({ s }) => stationSummary(s, items).free > 0) ?? null;
}
