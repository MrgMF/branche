// Identifiants de points de charge (EVSE) : points d'une station, et recherche d'une borne par identifiant
// (QR code, lien profond) même hors de la zone chargée, via l'index publié par le pipeline (data/evse/<seau>.json).
import { DATA_URL } from './config';
import { findByEvse, type Plug, type Station } from './stations';

export const normId = (id: string) => id.toUpperCase().replace(/[*\s]/g, '');

/** FNV-1a 32 bits modulo 256 — identique à pipeline/src/normalize.mjs (vecteurs partagés dans les tests). */
export function evseBucket(id: string): string {
  let h = 0x811c9dc5;
  const s = normId(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 256).toString(16).padStart(2, '0');
}

export interface ChargePoint {
  id: string;
  kw: number;
  plugs: Plug[];
  /** 4 derniers caractères, comme sur l'étiquette de la borne. */
  short: string;
  /** Prises connues pour CE point (sinon : prises de la station). */
  exact: boolean;
}

export const shortId = (id: string) => normId(id).slice(-4);

/** Points de charge d'une station (tuiles V2 : prises par point ; anciennes tuiles : prises de la station). */
export function pointsOf(s: Station): ChargePoint[] {
  const list = (s.pdc ?? []).map(([id, kw, plugs]) => ({ id, kw: kw || s.kw, plugs: plugs?.length ? plugs : s.c, short: shortId(id), exact: !!plugs?.length }));
  return list.length ? list : [{ id: s.id, kw: s.kw, plugs: s.c, short: shortId(s.id), exact: false }];
}

export function pointById(s: Station, id: string | undefined | null): ChargePoint | undefined {
  if (!id) return undefined;
  const n = normId(id);
  return pointsOf(s).find((p) => normId(p.id) === n);
}

const json = async <T>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
};

/**
 * Retrouve la station d'un identifiant de point ou de station : d'abord parmi les stations chargées,
 * sinon via l'index EVSE. `null` si inconnu (ou hors ligne).
 */
export async function findStation(id: string, loaded: Station[]): Promise<{ station: Station; pdcId: string | null } | null> {
  const n = normId(id);
  const local = findByEvse(loaded, n);
  if (local) return { station: local, pdcId: normId(local.id) === n ? null : n };
  try {
    const idx = await json<{ m: Record<string, string> }>(`${DATA_URL}/evse/${evseBucket(n)}.json`);
    const hit = idx.m[n];
    if (!hit) return null;
    const [tile, stationId] = hit.split('|');
    const t = await json<{ s: Station[] }>(`${DATA_URL}/tiles/${tile}.json`);
    const station = stationId ? t.s.find((s) => s.id === stationId) : findByEvse(t.s, n);
    if (!station) return null;
    return { station, pdcId: normId(station.id) === n ? null : n };
  } catch {
    return null;
  }
}
