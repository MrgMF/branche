// Fiabilité et prix constatés par la communauté (API Branché, facultative) — l'app fonctionne sans.
// Retours saisis hors ligne : file d'attente locale (AsyncStorage), renvoyée au retour du réseau (checkinSync.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
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

/** Réponse HTTP refusée (≠ réseau coupé) : ne pas renvoyer indéfiniment une requête que l'API rejette. */
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function call<T>(path: string, init?: RequestInit, ms = 6000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${API_URL}${path}`, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json' } });
    if (!r.ok) throw new HttpError(r.status);
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

export interface Checkin {
  stationId: string;
  ok: boolean;
  pricePaid?: number;
  kWh?: number;
  preauth?: number;
}
/** sent : reçu par l'API ; queued : hors ligne, renvoyé plus tard ; rejected : refusé par l'API ; off : pas d'API. */
export type SendResult = 'sent' | 'queued' | 'rejected' | 'off';

const QUEUE_KEY = 'branche.checkins.queue.v1';
const QUEUE_MAX = 30;
const QUEUE_TTL = 7 * 24 * 3600_000;
interface Queued {
  body: Checkin;
  at: number;
}

async function readQueue(): Promise<Queued[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as Queued[]) : [];
    return Array.isArray(list) ? list.filter((q) => q?.body && typeof q.body.stationId === 'string' && typeof q.at === 'number') : [];
  } catch {
    return [];
  }
}
async function writeQueue(list: Queued[]): Promise<void> {
  await (list.length ? AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(list)) : AsyncStorage.removeItem(QUEUE_KEY)).catch(() => undefined);
}

/** Retours en attente d'envoi (hors ligne). */
export async function pendingCheckins(): Promise<number> {
  return (await readQueue()).length;
}

const post = (body: Checkin) => call('/v1/checkins', { method: 'POST', body: JSON.stringify(body) });
const isRejected = (e: unknown) => e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

/** Retour anonyme « Ça a marché ? » : aucun identifiant, aucune position. Hors ligne : mis en file, renvoyé plus tard. */
export async function sendCheckin(body: Checkin): Promise<SendResult> {
  if (!communityEnabled()) return 'off';
  try {
    await post(body);
    cache.delete(body.stationId);
    void flushCheckins();
    return 'sent';
  } catch (e) {
    if (isRejected(e)) return 'rejected';
    const list = await readQueue();
    await writeQueue([...list, { body, at: Date.now() }].slice(-QUEUE_MAX));
    return 'queued';
  }
}

let flushing: Promise<number> | null = null;
/** Renvoie la file (dans l'ordre) ; s'arrête au premier échec réseau. Retourne le nombre de retours envoyés. */
export function flushCheckins(): Promise<number> {
  if (!communityEnabled()) return Promise.resolve(0);
  if (!flushing) {
    flushing = (async () => {
      const now = Date.now();
      let list = (await readQueue()).filter((q) => now - q.at < QUEUE_TTL);
      let sent = 0;
      while (list.length) {
        try {
          await post(list[0].body);
          cache.delete(list[0].body.stationId);
          sent++;
        } catch (e) {
          if (!isRejected(e)) break; // toujours hors ligne : on réessaiera
        }
        list = list.slice(1);
        await writeQueue(list);
      }
      await writeQueue(list);
      return sent;
    })().finally(() => {
      flushing = null;
    });
  }
  return flushing;
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
