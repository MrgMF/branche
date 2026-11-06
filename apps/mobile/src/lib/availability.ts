// Disponibilité temps réel par point (GET /v1/availability, équipe disponibilité) — cache 60 s, dégradation propre.
import { API_URL } from './config';
import type { Station } from './stations';
import { tr } from '../i18n';

export type AvailStatus = 'libre' | 'occupe' | 'hors_service' | 'inconnu';
export interface AvailItem {
  status: AvailStatus;
  at: string;
}
export const availLabel = (s: AvailStatus): string => tr().avail[s];

const TTL = 60_000;
const cache = new Map<string, { t: number; v: AvailItem | null }>();

/** Statuts connus pour ces points ({} si l'API est absente ou injoignable). */
export async function getAvailability(ids: string[]): Promise<Record<string, AvailItem>> {
  const out: Record<string, AvailItem> = {};
  if (!API_URL || !ids.length) return out;
  const now = Date.now();
  const missing = ids.filter((id) => {
    const c = cache.get(id);
    return !c || now - c.t > TTL;
  });
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`${API_URL}/v1/availability?ids=${chunk.map(encodeURIComponent).join(',')}`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { items?: Record<string, AvailItem> };
      for (const id of chunk) cache.set(id, { t: now, v: j.items?.[id] ?? null });
    } catch {
      for (const id of chunk) cache.set(id, { t: now - TTL + 15_000, v: null }); // réessai dans 15 s
    }
  }
  for (const id of ids) {
    const v = cache.get(id)?.v;
    if (v) out[id] = v;
  }
  return out;
}

/**
 * Résumé par station : points libres / connus. `reported` : points pour lesquels l'API a répondu (statut « inconnu »
 * compris) ; 0 pendant le chargement, en cas d'échec ou sans donnée : rien n'est affiché (jamais « État inconnu » inventé).
 */
export function stationSummary(s: Station, items: Record<string, AvailItem>) {
  const ids = (s.pdc ?? []).map(([id]) => id);
  const reported = ids.map((id) => items[id]?.status).filter((x): x is AvailStatus => !!x);
  const known = reported.filter((x) => x !== 'inconnu');
  return { free: known.filter((x) => x === 'libre').length, down: known.filter((x) => x === 'hors_service').length, known: known.length, reported: reported.length, total: ids.length };
}

/** Pastille d'une station : statut temps réel, « unknown » seulement si l'API renvoie ce statut, null sinon (rien à afficher). */
export type StationStatus = 'free' | 'busy' | 'down' | 'unknown';
export function stationStatus(sum: ReturnType<typeof stationSummary>): StationStatus | null {
  if (sum.known) return sum.free ? 'free' : sum.down === sum.known ? 'down' : 'busy';
  return sum.reported ? 'unknown' : null;
}
