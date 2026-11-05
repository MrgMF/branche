// Historique des recharges et dépenses — stocké uniquement sur l'appareil (AsyncStorage), jamais envoyé.
import AsyncStorage from '@react-native-async-storage/async-storage';
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

async function save(list: ChargeRecord[]) {
  cache = list;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* stockage plein ou indisponible : gardé en mémoire */
  }
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
  return next;
}

export async function clearHistory(): Promise<void> {
  cache = [];
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* rien */
  }
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

const csvCell = (v: string | number | null | undefined, sep: string) => {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', decimalSep()) : v;
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
