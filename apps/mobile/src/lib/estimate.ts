// Estimation d'une recharge pour MON véhicule : kWh de X % à 80 %, durée réaliste, coût total — fonctions pures (estimate.test.ts).
// Modèle volontairement simple et annoncé comme tel : puissance = min(point, véhicule) ; en courant continu,
// la puissance baisse au-delà de 50 % (45 % de la puissance max à 80 %). Pertes de charge incluses dans les kWh facturés.
import type { Plug } from './stations';
import { ttcFactor, type Tariff } from './tariff';
import { GENERIC_VEHICLE, type VehicleModel } from './vehicle';
import { durationMin } from '../i18n/format';

export interface EstimateInput {
  vehicle: Pick<VehicleModel, 'batteryKWh' | 'maxDcKW' | 'maxAcKW'> | null;
  /** Batterie actuelle (%) ; null → 20 % supposés. */
  socPercent: number | null;
  /** Objectif (%), 80 par défaut (au-delà, la charge rapide devient très lente). */
  targetPercent?: number;
  /** Puissance du point (kW), 0 si inconnue. */
  pointKw: number;
  plugs: Plug[];
  tariff: Tariff;
}

export interface Estimate {
  assumedVehicle: boolean;
  assumedSoc: boolean;
  assumedPower: boolean;
  dc: boolean;
  /** Puissance de départ réellement possible (kW) : min(point, véhicule). */
  powerKw: number;
  fromSoc: number;
  toSoc: number;
  /** Énergie entrée dans la batterie (kWh). */
  kWh: number;
  /** Énergie facturée, pertes incluses (kWh). */
  kWhBilled: number;
  minutes: number;
  /** Coût total TTC estimé (€), null si le prix est inconnu. */
  cost: number | null;
  parts: { energy: number; time: number; session: number } | null;
  /** Le tarif publié ne permet qu'une estimation partielle (ex. seulement l'occupation). */
  partial: boolean;
  unknownPrice: boolean;
  free: boolean;
}

export const DEFAULT_SOC = 20;
export const DEFAULT_TARGET = 80;
const STEP = 0.5; // % par pas de simulation

export const isDc = (pointKw: number, plugs: Plug[]) =>
  plugs.some((p) => p === 'ccs' || p === 'chademo') ? pointKw === 0 || pointKw >= 25 : pointKw > 43;

/** Puissance (kW) acceptée à l'état de charge `soc` (%). */
export function powerAt(maxKw: number, soc: number, dc: boolean): number {
  if (!dc) return soc < 95 ? maxKw : maxKw * 0.6;
  if (soc <= 50) return maxKw;
  if (soc <= 80) return maxKw * (1 - (0.55 * (soc - 50)) / 30);
  return maxKw * (0.45 - (0.25 * (soc - 80)) / 20);
}

function setup(i: EstimateInput) {
  const v = i.vehicle ?? GENERIC_VEHICLE;
  const dc = isDc(i.pointKw, i.plugs);
  const assumedPower = !i.pointKw;
  const point = i.pointKw || (dc ? 50 : 7.4);
  const carMax = dc ? v.maxDcKW || v.maxAcKW : v.maxAcKW;
  const maxKw = Math.max(1, Math.min(point, carMax || point));
  const from = Math.max(0, Math.min(100, i.socPercent ?? DEFAULT_SOC));
  const target = i.targetPercent ?? DEFAULT_TARGET;
  const to = from < target ? target : Math.min(100, from + 10);
  return { v, dc, maxKw, from, to, assumedPower, loss: dc ? 1.05 : 1.1 };
}

/** Prix TTC pour une énergie et une durée données (null si inconnu). */
export function costOf(t: Tariff, kWhBilled: number, minutes: number): { total: number; energy: number; time: number; session: number } | null {
  if (t.kind === 'free') return { total: 0, energy: 0, time: 0, session: 0 };
  if (t.kind !== 'priced') return null;
  const f = ttcFactor(t);
  const energy = (t.perKwh ?? 0) * kWhBilled * f;
  const limit = t.perMinLater?.afterMin ?? Infinity;
  let time = (t.perMin ?? 0) * Math.min(minutes, limit);
  if (t.perMinLater) time += t.perMinLater.perMin * Math.max(0, minutes - t.perMinLater.afterMin);
  time *= f;
  const session = (t.session ?? 0) * f;
  return { total: energy + time + session, energy, time, session };
}

export function estimateCharge(i: EstimateInput): Estimate {
  const s = setup(i);
  let minutes = 0;
  for (let soc = s.from; soc < s.to; soc += STEP) {
    const step = Math.min(STEP, s.to - soc);
    minutes += ((s.v.batteryKWh * step) / 100 / powerAt(s.maxKw, soc, s.dc)) * 60;
  }
  const kWh = (s.v.batteryKWh * (s.to - s.from)) / 100;
  const kWhBilled = kWh * s.loss;
  const c = costOf(i.tariff, kWhBilled, minutes);
  const t = i.tariff;
  return {
    assumedVehicle: !i.vehicle,
    assumedSoc: i.socPercent == null,
    assumedPower: s.assumedPower,
    dc: s.dc,
    powerKw: Math.round(s.maxKw * 10) / 10,
    fromSoc: s.from,
    toSoc: s.to,
    kWh: round1(kWh),
    kWhBilled: round1(kWhBilled),
    minutes: Math.round(minutes),
    cost: c ? Math.round(c.total * 100) / 100 : null,
    parts: c ? { energy: round2(c.energy), time: round2(c.time), session: round2(c.session) } : null,
    partial: t.kind === 'priced' && t.perKwh === undefined && !t.perMin && !t.perMinLater && !t.session,
    unknownPrice: !c,
    free: t.kind === 'free',
  };
}

export interface Progress {
  soc: number;
  kWh: number;
  kWhBilled: number;
  cost: number | null;
  /** Minutes restantes avant l'objectif (0 si atteint). */
  remainingMin: number;
  done: boolean;
}

/** État estimé après `elapsedMin` minutes de charge (suivi en direct). */
export function progressAt(i: EstimateInput, elapsedMin: number): Progress {
  const s = setup(i);
  let soc = s.from;
  let t = 0;
  while (soc < s.to) {
    const step = Math.min(STEP, s.to - soc);
    const dt = ((s.v.batteryKWh * step) / 100 / powerAt(s.maxKw, soc, s.dc)) * 60;
    if (t + dt > elapsedMin) {
      soc += step * ((elapsedMin - t) / dt);
      t = elapsedMin;
      break;
    }
    t += dt;
    soc += step;
  }
  const done = soc >= s.to - 1e-9;
  const total = estimateCharge(i).minutes;
  const kWh = (s.v.batteryKWh * (soc - s.from)) / 100;
  const c = costOf(i.tariff, kWh * s.loss, Math.max(t, elapsedMin));
  return {
    soc: Math.round(soc),
    kWh: round1(kWh),
    kWhBilled: round1(kWh * s.loss),
    cost: c ? round2(c.total) : null,
    remainingMin: done ? 0 : Math.max(0, Math.round(total - elapsedMin)),
    done,
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Durée lisible : « 42 min », « 1 h 05 ». */
export const durationLabel = durationMin;
