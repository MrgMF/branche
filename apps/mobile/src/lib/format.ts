// Formats d'affichage : délégués à src/i18n (langue et unités courantes).
import { localeTag, tr } from '../i18n';
import { euros as eurosFmt, kmText, kwhText, kwText } from '../i18n/format';
import type { PayMethod, Plug } from './stations';

/** Espace insécable (U+00A0) : un nombre n'est jamais séparé de son unité en fin de ligne. */
export const NBSP = '\u00A0';
const UNIT = /(\d)[ \u202F](?=(?:kWh|kW|km\/h|km|mph|mi|ft|min|m|h|%|€)(?![\p{L}\d]))/gu;

/**
 * `withUnit(12, 'kW')` → « 12 kW » insécable ; `withUnit('350 m · 2 min')` : remplace l'espace entre chaque nombre et son
 * unité (m, km, min, h, kW, kWh, %, €, mi, ft) par une espace insécable. Idempotent.
 */
export function withUnit(value: string | number, unit?: string): string {
  if (unit != null) return `${value}${NBSP}${unit}`;
  return String(value).replace(UNIT, `$1${NBSP}`);
}

export const euros = (cents: number) => withUnit(eurosFmt(cents));

export const km = (d: number) => withUnit(kmText(d));

/** Temps de trajet indicatif en ville (≈ 25 km/h), arrondi à la minute. */
export const minutes = (d: number) => withUnit(Math.max(1, Math.round((d / 25) * 60)), 'min');

export const kw = (v: number) => withUnit(kwText(v));

/** Pourcentage entier insécable (« 80 % » en français, « 80% » ailleurs : Intl). */
export const pct = (v: number) => withUnit(new Intl.NumberFormat(localeTag(), { style: 'percent', maximumFractionDigits: 0 }).format(v / 100));

export const plugLabel = (p: Plug) => tr().plugs[p];
export const payLabel = (p: PayMethod) => tr().pay[p];

export const kwh = (wh: number) => withUnit(kwhText(Math.round(wh / 100) / 10));

/** Durée unique de la fin de recharge et du reçu : « 3 s », « 12 min », « 1 h 05 » (insécables). */
export function durationShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return withUnit(s, 's');
  const m = Math.floor(s / 60);
  if (m < 60) return withUnit(m, 'min');
  return `${withUnit(Math.floor(m / 60), 'h')}${NBSP}${String(m % 60).padStart(2, '0')}`;
}
