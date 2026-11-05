// Formats selon la langue (Intl) et les unités choisies : nombres, euros, distances, vitesses, heures, dates, durées.
import { localeTag, tr, units } from './index';

const nf = (x: number, min = 0, max = 1, grouping = true) =>
  new Intl.NumberFormat(localeTag(), { minimumFractionDigits: min, maximumFractionDigits: Math.max(min, max), useGrouping: grouping }).format(x);

export const num = (x: number, max = 1, min = 0) => nf(x, min, max);
/** Montant en euros (nombre d'euros). */
export const eur = (x: number, digits = 2) =>
  new Intl.NumberFormat(localeTag(), { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);
/** Montant en centimes. */
export const euros = (cents: number) => eur(cents / 100);
export const perKwh = (x: number) => `${nf(x, 2, x < 0.1 ? 3 : 2)} €/kWh`;
export const perMin = (x: number) => `${nf(x, 0, 3)} €/min (${nf(x * 60, 2, 2)} €/h)`;
export const kwhText = (kwh: number) => `${nf(kwh, 0, 1)} kWh`;
export const kwText = (v: number) => (v ? `${nf(v, 0, 1)} kW` : tr().common.powerUnknown);
/** Séparateur décimal de la langue (export CSV). */
export const decimalSep = () => (nf(1.5, 1, 1).includes(',') ? ',' : '.');

const MI = 1609.344;
const FT = 0.3048;

/** Distance courte et lisible (« 350 m », « 2,4 km » ; « 0.3 mi », « 500 ft »). */
export function distText(m: number): string {
  if (units() === 'mi') {
    const mi = m / MI;
    return mi < 0.1 ? `${Math.max(10, Math.round(m / FT / 10) * 10)} ft` : `${nf(mi, 0, 1)} mi`;
  }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${nf(m / 1000, 0, 1)} km`;
}
/** Distance en kilomètres → texte (listes de bornes : mètres sous 1 km). */
export const kmText = (km: number) => (units() === 'km' && km < 1 ? `${Math.round(km * 1000)} m` : distText(km * 1000));

/** Distance du bandeau de guidage : arrondis de lecture rapide (comme Waze). */
export function bigDist(m: number): { value: string; unit: string } {
  if (units() === 'mi') {
    const mi = m / MI;
    if (mi >= 10) return { value: String(Math.round(mi)), unit: 'mi' };
    if (mi >= 0.2) return { value: nf(Math.round(mi * 10) / 10, 0, 1), unit: 'mi' };
    const ft = m / FT;
    return { value: String(ft >= 300 ? Math.round(ft / 50) * 50 : Math.max(0, Math.round(ft / 10) * 10)), unit: 'ft' };
  }
  if (m >= 10000) return { value: String(Math.round(m / 1000)), unit: 'km' };
  if (m >= 1000) return { value: nf(Math.round(m / 100) / 10, 0, 1), unit: 'km' };
  if (m >= 300) return { value: String(Math.round(m / 50) * 50), unit: 'm' };
  return { value: String(Math.max(0, Math.round(m / 10) * 10)), unit: 'm' };
}

/** Distance lue par la voix (« 1,5 kilomètre », « 300 mètres », « half a mile »…). */
export function spokenDist(m: number): string {
  const v = tr().voice;
  if (units() === 'mi') {
    const mi = m / MI;
    if (mi >= 0.3) {
      const r = Math.round(mi * 4) / 4;
      return v.miles(r, nf(r, 0, 2));
    }
    const ft = m / FT;
    const r = ft >= 500 ? Math.round(ft / 100) * 100 : Math.max(50, Math.round(ft / 50) * 50);
    return v.feet(r);
  }
  if (m >= 950) {
    const k = Math.round(m / 500) / 2;
    return v.km(k, nf(k, 0, 1));
  }
  return v.meters(m >= 200 ? Math.round(m / 100) * 100 : Math.max(10, Math.round(m / 10) * 10));
}

/** Vitesse (km/h ou mph) arrondie, et son unité. */
export const speedValue = (kmh: number) => Math.round(units() === 'mi' ? kmh / 1.609344 : kmh);
export const speedUnit = () => (units() === 'mi' ? 'mph' : 'km/h');

export const clock = (t: number) => new Intl.DateTimeFormat(localeTag(), { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
export const etaClock = (seconds: number, now = Date.now()) => clock(now + seconds * 1000);
export const dateShort = (t: number) => new Intl.DateTimeFormat(localeTag(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t));
export const dateLong = (t: number) => new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
export const dateNum = (t: number | string) => new Intl.DateTimeFormat(localeTag(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(typeof t === 'string' ? new Date(`${t}T12:00:00`) : new Date(t));
export const monthYear = (d: Date) => new Intl.DateTimeFormat(localeTag(), { month: 'long', year: 'numeric' }).format(d);

/** Durée en minutes : « 42 min », « 1 h 05 ». */
export function durationMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
/** Durée en secondes (au moins 1 min). */
export const durationText = (s: number) => durationMin(Math.max(1, Math.round(s / 60)));
