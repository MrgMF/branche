// Estimation d'une recharge pour MON véhicule : kWh de X % à 80 %, durée réaliste, coût total — fonctions pures (estimate.test.ts).
// Modèle volontairement simple et annoncé comme tel : puissance = min(point, véhicule) ; en courant continu,
// la puissance baisse au-delà de 50 % (45 % de la puissance max à 80 %). Pertes de charge incluses dans les kWh facturés.
import type { Plug } from './stations';
import { tariffAtMinute, ttcFactor, type Tariff, type TariffBand } from './tariff';
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
  /** Heure de début prévue (ms) pour les tarifs à plages horaires ; maintenant par défaut. */
  startAt?: number;
}

/**
 * Tarif applicable à une recharge à plages horaires : `flat` (pas de plages analysées), `band` (une seule plage),
 * `overlap` (la recharge chevauche plusieurs plages : la plus chère pour cette recharge, dit à l'écran), `fallback`
 * (heure non couverte par les plages publiées : tarif le plus élevé, dit à l'écran).
 */
export type BandMode = 'flat' | 'band' | 'overlap' | 'fallback';

const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/** Tarifs (distincts) rencontrés entre `startAt` et `startAt + minutes` (pas de 5 min) ; null = une heure non couverte. */
function tariffsDuring(t: Tariff, startAt: number, minutes: number): (Tariff | null)[] {
  const seen: (Tariff | null)[] = [];
  const steps = Math.max(1, Math.ceil(minutes / 5));
  for (let k = 0; k <= steps; k++) {
    const at = startAt + Math.min(minutes, k * 5) * 60_000;
    const x = tariffAtMinute(t, minuteOfDay(at));
    if (!seen.includes(x)) seen.push(x);
  }
  return seen;
}

/** Choix du tarif applicable (voir BandMode) pour une énergie et une durée données. */
export function applicableTariff(t: Tariff, startAt: number, kWhBilled: number, minutes: number): { tariff: Tariff; mode: BandMode } {
  if (!t.bands) return { tariff: t, mode: 'flat' };
  const during = tariffsDuring(t, startAt, minutes);
  if (during.includes(null)) return { tariff: t, mode: 'fallback' };
  const list = during as Tariff[];
  if (list.length === 1) return { tariff: list[0], mode: 'band' };
  const cost = (x: Tariff) => costOf(x, kWhBilled, minutes)?.total ?? Infinity;
  return { tariff: list.reduce((a, b) => (cost(b) > cost(a) ? b : a)), mode: 'overlap' };
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
  /** Gratuité déclarée mais non crédible (≥ 50 kW ou moyen de paiement) : coût inconnu, « à vérifier ». */
  freeDoubtful: boolean;
  /** Tarif réellement appliqué (plage de l'heure de début) et façon dont il a été choisi. */
  applied: Tariff;
  bandMode: BandMode;
}

export const DEFAULT_SOC = 20;
export const DEFAULT_TARGET = 80;
const STEP = 0.5; // % par pas de simulation

export const isDc = (pointKw: number, plugs: Plug[]) => {
  const dcPlug = (p: Plug) => p === 'ccs' || p === 'chademo';
  // Prise CCS ou CHAdeMO seule : courant continu quelle que soit la puissance (Electra 24 kW CHAdeMO)
  if (plugs.length && plugs.every(dcPlug)) return true;
  return plugs.some(dcPlug) ? pointKw === 0 || pointKw >= 25 : pointKw > 43;
};

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
  const { tariff: t, mode } = applicableTariff(i.tariff, i.startAt ?? Date.now(), kWhBilled, minutes);
  const c = costOf(t, kWhBilled, minutes);
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
    freeDoubtful: !!t.freeDoubtful,
    applied: t,
    bandMode: mode,
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
  const full = estimateCharge(i);
  const total = full.minutes;
  const kWh = (s.v.batteryKWh * (soc - s.from)) / 100;
  const c = costOf(full.applied, kWh * s.loss, Math.max(t, elapsedMin));
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

// ——— Coût total réel de MA recharge (V2.1 prix) ———
// Énergie + temps de charge + forfait de session + pénalité d'occupation estimée selon la durée de stationnement prévue.
// Tarif inconnu ou seulement partiel → total null (affiché « Inconnu »), jamais 0.

/** Durée de stationnement prévue : la durée de charge (par défaut), ~1 h, ~2 h ou la nuit. */
export type Stay = 'charge' | '1h' | '2h' | 'night';
export const STAYS: readonly Stay[] = ['charge', '1h', '2h', 'night'];
/** « La nuit » : 10 h supposées (20 h → 6 h), annoncées dans le libellé. */
export const STAY_MIN: Record<Exclude<Stay, 'charge'>, number> = { '1h': 60, '2h': 120, night: 600 };
export const stayMinutes = (s: Stay): number | null => (s === 'charge' ? null : STAY_MIN[s]);

export interface TotalCost {
  /** Tarif appliqué (plage de l'heure de début) et mode de choix. */
  applied: Tariff;
  bandMode: BandMode;
  /** Énergie facturée (kWh, pertes incluses). */
  kWh: number;
  /** Minutes de charge réelles (écourtées si l'on repart avant la fin). */
  chargeMin: number;
  /** Batterie de départ et objectif (%), comme estimateCharge. */
  fromSoc: number;
  toSoc: number;
  /** Minutes de stationnement (≥ durée de charge). */
  stayMin: number;
  /** On repart avant d'avoir atteint l'objectif : kWh et coût de la charge partielle. */
  cutShort: boolean;
  /** Postes TTC (€), null si le tarif est inconnu. */
  energy: number | null;
  time: number | null;
  session: number | null;
  idle: number | null;
  /** Recharge seule (énergie + temps + forfait), TTC. */
  charge: number | null;
  /** Coût total TTC (recharge + occupation), null = « Inconnu ». */
  total: number | null;
  /** Prix effectif : coût total / kWh facturés (€/kWh TTC), null si inconnu. */
  effectivePerKwh: number | null;
  /** Prix au kWh publié, TTC (null si non publié). */
  perKwh: number | null;
  /** Minutes après le branchement à partir desquelles l'occupation est facturée (null : pas d'occupation publiée). */
  idleFromMin: number | null;
  unknown: boolean;
  free: boolean;
}

export function totalCost(i: EstimateInput & { stayMin?: number | null }): TotalCost {
  const est = estimateCharge(i);
  const t = est.applied;
  const wanted = i.stayMin ?? est.minutes;
  const cutShort = wanted < est.minutes;
  const chargeMin = cutShort ? wanted : est.minutes;
  const kWh = cutShort ? progressAt(i, wanted).kWhBilled : est.kWhBilled;
  const stayMin = Math.max(chargeMin, wanted);
  const f = ttcFactor(t);
  const idleFromMin = t.kind === 'priced' && t.idle ? est.minutes + t.idle.afterMin : null;
  const base = { applied: t, bandMode: est.bandMode, kWh, chargeMin, fromSoc: est.fromSoc, toSoc: est.toSoc, stayMin, cutShort, idleFromMin, perKwh: t.kind === 'priced' && t.perKwh !== undefined ? round4(t.perKwh * f) : null, free: t.kind === 'free' };
  // Seulement une occupation publiée (estimation partielle) : coût de la recharge inconnu.
  // Recharge complète : mêmes montants que estimateCharge (kWh non arrondis) ; écourtée : kWh atteints au départ.
  const c = est.partial ? null : !cutShort && est.cost != null && est.parts ? { total: est.cost, ...est.parts } : costOf(t, kWh, chargeMin);
  if (!c) return { ...base, energy: null, time: null, session: null, idle: null, charge: null, total: null, effectivePerKwh: null, unknown: true };
  const idle = t.kind === 'priced' && t.idle && idleFromMin !== null ? t.idle.perMin * Math.max(0, stayMin - idleFromMin) * f : 0;
  const total = c.total + idle;
  return {
    ...base,
    energy: round2(c.energy),
    time: round2(c.time),
    session: round2(c.session),
    idle: round2(idle),
    charge: round2(c.total),
    total: round2(total),
    effectivePerKwh: kWh > 0 ? round4(total / kWh) : null,
    unknown: false,
  };
}

/** Pièges tarifaires (une ligne chacun), calculés pour MA recharge. */
export type PriceTrap =
  /** Facturation au temps : prix ramené au kWh pour ce véhicule (recharge seule, hors occupation). */
  | { kind: 'perMin'; perKwh: number; worse: boolean }
  /** Forfait de session > 20 % du total. */
  | { kind: 'session'; share: number }
  /** Occupation facturée `afterMin` min après la fin de charge, soit `inMin` min après le branchement ; `at` si l'heure est connue. */
  | { kind: 'idle'; afterMin: number; inMin: number; at: number | null };

/** Seuils des alertes (spécification V2.1). */
export const TRAP_SESSION_SHARE = 0.2;
export const TRAP_TIME_RATIO = 1.3;

/**
 * `plugAt` : heure de branchement (ms) si elle est connue (sur place : maintenant), sinon l'alerte d'occupation donne un délai.
 * Honnête : rien sans tarif publié ; « minute » seulement s'il y a réellement une part au temps facturée pour cette recharge
 * (`worse` : effectif > 1,3 × le prix au kWh publié).
 */
export function priceTraps(_published: Tariff, c: TotalCost, plugAt: number | null = null): PriceTrap[] {
  // Évaluées sur la seule plage applicable (jamais sur la somme des plages)
  const t = c.applied;
  const out: PriceTrap[] = [];
  if (t.kind !== 'priced') return out;
  if (c.charge != null && c.kWh > 0) {
    const eff = c.charge / c.kWh;
    // Part au temps facturée (seule cause possible d'un effectif > 1,3 × le kWh hors forfait, signalé à part)
    if ((c.time ?? 0) > 0) out.push({ kind: 'perMin', perKwh: round2(eff), worse: c.perKwh != null && eff > TRAP_TIME_RATIO * c.perKwh });
  }
  if (c.total != null && c.total > 0 && (c.session ?? 0) / c.total > TRAP_SESSION_SHARE) out.push({ kind: 'session', share: round2((c.session ?? 0) / c.total) });
  if (t.idle && c.idleFromMin != null) out.push({ kind: 'idle', afterMin: t.idle.afterMin, inMin: c.idleFromMin, at: plugAt != null ? plugAt + c.idleFromMin * 60_000 : null });
  return out;
}

/** Rappel d'occupation : 10 min avant le début des frais. */
export const IDLE_ALERT_LEAD_MIN = 10;

const round4 = (x: number) => Math.round(x * 10000) / 10000;

/** Coût de cette recharge plage par plage (« 06:00–18:00 ≈ 12,10 € · par défaut ≈ 9,90 € ») ; vide sans plages. */
export function bandCosts(i: EstimateInput): { band: Pick<TariffBand, 'from' | 'to'> | null; cost: number | null }[] {
  const b = i.tariff.bands;
  if (!b) return [];
  const one = (tariff: Tariff) => estimateCharge({ ...i, tariff }).cost;
  return [...b.list.map((x) => ({ band: { from: x.from, to: x.to }, cost: one(x.tariff) })), ...(b.default ? [{ band: null, cost: one(b.default) }] : [])];
}
