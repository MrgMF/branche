// Historique des recharges et dépenses — stocké uniquement sur l'appareil (AsyncStorage), jamais envoyé.
// Toute écriture qui échoue lève HistorySaveError : l'écran l'affiche (Notice), rien n'est perdu en silence.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { removeTicket } from './ticket';
import { tr } from '../i18n';
import { decimalSep, monthYear } from '../i18n/format';

export type MethodId = 'account' | 'scan' | 'operator-link' | 'reader' | 'badge';

export const methodLabel = (m: MethodId): string => tr().methodLabel[m] ?? m;

export interface ChargeRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  stationId: string;
  stationName: string;
  operatorName: string;
  pdcId?: string;
  method: MethodId;
  /** kWh lus sur le ticket, ou estimés (kWhEstimated). */
  kWh: number | null;
  kWhEstimated: boolean;
  /** Montant payé déclaré par l'utilisateur (€ TTC), facultatif. */
  pricePaid: number | null;
  estimatedCost: number | null;
  ok: boolean | null;
  vehicleName?: string;
  startSoc?: number;
  endSoc?: number;
  /** Photo du ticket gardée sur l'appareil (ticket.ts). */
  ticket?: boolean;
}

const KEY = 'branche.history.v1';
let cache: ChargeRecord[] | null = null;

export async function loadHistory(): Promise<ChargeRecord[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as ChargeRecord[]) : [];
    cache = Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Enregistrement de l'historique impossible (stockage plein ou indisponible) : à afficher à l'utilisateur. */
export class HistorySaveError extends Error {
  constructor(cause?: unknown) {
    super('Historique non enregistré sur l’appareil');
    this.name = 'HistorySaveError';
    this.cause = cause;
  }
}

/** Persiste la liste ; en cas d'échec, rien n'est changé (ni en mémoire ni sur l'appareil) et l'erreur remonte. */
async function save(list: ChargeRecord[]) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    throw new HistorySaveError(e);
  }
  cache = list;
}

export async function addRecord(r: ChargeRecord): Promise<ChargeRecord[]> {
  const list = await loadHistory();
  const next = [r, ...list.filter((x) => x.id !== r.id)].sort((a, b) => b.startedAt - a.startedAt).slice(0, 500);
  await save(next);
  return next;
}

export async function removeRecord(id: string): Promise<ChargeRecord[]> {
  const next = (await loadHistory()).filter((r) => r.id !== id);
  await save(next);
  await removeTicket(id);
  return next;
}

/** Met à jour une recharge (ex. photo du ticket ajoutée ou supprimée). */
export async function updateRecord(id: string, patch: Partial<ChargeRecord>): Promise<ChargeRecord[]> {
  const next = (await loadHistory()).map((r) => (r.id === id ? { ...r, ...patch, id } : r));
  await save(next);
  return next;
}

/**
 * Stockage plein : supprime toutes les photos de tickets (place libérée) ; les recharges restent dans l'historique.
 * Renvoie le nombre de photos supprimées. Si l'historique ne peut pas être réécrit, les photos sont quand même
 * supprimées (la fiche affiche alors « photo supprimée »).
 */
export async function removeAllTickets(): Promise<number> {
  const list = await loadHistory();
  const withTicket = list.filter((r) => r.ticket);
  await Promise.all(withTicket.map((r) => removeTicket(r.id)));
  if (withTicket.length) await save(list.map((r) => (r.ticket ? { ...r, ticket: false } : r))).catch(() => undefined);
  return withTicket.length;
}

export async function clearHistory(): Promise<void> {
  const list = cache ?? (await loadHistory());
  await Promise.all(list.filter((r) => r.ticket).map((r) => removeTicket(r.id)));
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    throw new HistorySaveError(e);
  }
  cache = [];
}

/** Dépenses du mois de `now` : total déclaré, nombre de recharges, prix moyen au kWh (si montant ET kWh connus). */
export function monthStats(list: ChargeRecord[], now = Date.now()) {
  const d = new Date(now);
  const inMonth = list.filter((r) => {
    const x = new Date(r.startedAt);
    return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
  });
  return { ...totals(inMonth), month: monthYear(d) };
}

export function totals(list: ChargeRecord[]) {
  const paid = list.filter((r) => r.pricePaid != null);
  const total = paid.reduce((t, r) => t + (r.pricePaid ?? 0), 0);
  const both = paid.filter((r) => r.kWh && r.kWh > 0);
  const kWh = both.reduce((t, r) => t + (r.kWh ?? 0), 0);
  return {
    count: list.length,
    paidCount: paid.length,
    total: Math.round(total * 100) / 100,
    avgPerKwh: kWh > 0 ? Math.round((both.reduce((t, r) => t + (r.pricePaid ?? 0), 0) / kWh) * 1000) / 1000 : null,
    kWh: Math.round(list.reduce((t, r) => t + (r.kWh ?? 0), 0) * 10) / 10,
  };
}

/**
 * Cellule CSV. Texte commençant par = + - @ (ou tabulation / retour) : préfixé d'une apostrophe, pour qu'un tableur
 * ne l'exécute jamais comme formule (noms de stations IRVE, saisies). Les nombres restent des nombres.
 */
export const csvCell = (v: string | number | null | undefined, sep: string) => {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', decimalSep()) : /^(\s*[=+\-@]|[\t\r])/.test(v) ? `'${v}` : v;
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const two = (n: number) => String(n).padStart(2, '0');
const dateTime = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** Export CSV pour note de frais, BOM UTF-8 : « ; » et virgule décimale si la langue l'utilise (tableurs européens), sinon « , » et point. */
export function toCsv(list: ChargeRecord[]): string {
  const H = tr().history;
  const sep = decimalSep() === ',' ? ';' : ',';
  const head = H.csvHead;
  const rows = list.map((r) =>
    [
      dateTime(r.startedAt),
      dateTime(r.endedAt),
      r.stationName,
      r.operatorName,
      r.pdcId ?? '',
      methodLabel(r.method),
      r.kWh,
      r.kWhEstimated ? H.csvYes : H.csvNo,
      r.pricePaid,
      r.estimatedCost,
      r.ok == null ? '' : r.ok ? H.csvYes : H.csvNo,
      r.vehicleName ?? '',
    ]
      .map((c) => csvCell(c, sep))
      .join(sep),
  );
  return `﻿${[head.map((c) => csvCell(c, sep)).join(sep), ...rows].join('\r\n')}\r\n`;
}
