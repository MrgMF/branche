// Fiabilité et prix constatés par la communauté (API Branché, facultative) — l'app fonctionne sans.
import { API_URL } from './config';
import { tr } from '../i18n';
import { dateNum, eur, kwhText, perKwh } from '../i18n/format';

export interface Community {
  stationId: string;
  windowDays: number;
  checkins: number;
  okCount: number;
  successRate: number | null;
  lastOkAt: string | null;
  lastFailAt: string | null;
  recentPrices: { pricePaid: number; kWh: number | null; pricePerKwh: number | null; date: string }[];
  preauth: { median: number; count: number; lastDate: string } | null;
}

export const communityEnabled = () => API_URL.length > 0;

async function call<T>(path: string, init?: RequestInit, ms = 6000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${API_URL}${path}`, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const cache = new Map<string, { at: number; data: Community | null }>();

/** null si l'API est absente, injoignable ou lente : l'écran n'affiche alors simplement rien. */
export async function getCommunity(stationId: string): Promise<Community | null> {
  if (!communityEnabled()) return null;
  const hit = cache.get(stationId);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  try {
    const data = await call<Community>(`/v1/stations/${encodeURIComponent(stationId)}/community`);
    cache.set(stationId, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/** Retour anonyme « Ça a marché ? » : aucun identifiant, aucune position. Échec silencieux (hors ligne). */
export async function sendCheckin(body: { stationId: string; ok: boolean; pricePaid?: number; kWh?: number; preauth?: number }): Promise<boolean> {
  if (!communityEnabled()) return false;
  try {
    await call('/v1/checkins', { method: 'POST', body: JSON.stringify(body) });
    cache.delete(body.stationId);
    return true;
  } catch {
    return false;
  }
}


/** Phrase de fiabilité, ou null si trop peu de retours. */
export function reliabilityText(c: Community | null): string | null {
  if (!c || !c.checkins) return null;
  return tr().community.reliability(c.okCount, c.checkins, c.windowDays);
}

export function lastPriceText(c: Community | null): string | null {
  const p = c?.recentPrices[0];
  if (!p) return null;
  return tr().community.lastPrice(eur(p.pricePaid), p.kWh ? kwhText(p.kWh) : null, p.pricePerKwh != null ? perKwh(p.pricePerKwh) : null, dateNum(p.date));
}

export function preauthText(c: Community | null): string | null {
  if (!c?.preauth) return null;
  return tr().community.preauth(eur(c.preauth.median, 0), c.preauth.count, dateNum(c.preauth.lastDate));
}
