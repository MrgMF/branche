// Fin automatique : pendant une recharge suivie, un départ de la borne (> 150 m en roulant, ou constaté au retour
// dans l'app) termine la recharge à l'heure de départ estimée et l'ajoute à l'historique, sans aucun geste.
import { estimateCharge, progressAt } from './estimate';
import { addRecord, type ChargeRecord } from './history';
import { scheduleAlerts, cancelAlerts } from './notify';
import { distanceKm } from './stations';
import type { DirectCharge } from './store';
import { planTariff } from './tariff';
import { tr } from '../i18n';

export const AUTO_END_M = 150;
const DRIVING_MPS = 4; // ≈ 15 km/h
const FAR_M = 400; // sans vitesse connue (web) : éloignement franc

export interface Fix {
  lat: number;
  lon: number;
  /** m/s, null si inconnue */
  speed?: number | null;
  at: number;
}

/** Distance (m) à la borne, ou null si sa position est inconnue. */
export function distanceToStation(d: Pick<DirectCharge, 'station'>, f: Pick<Fix, 'lat' | 'lon'>): number | null {
  if (d.station.lat == null || d.station.lon == null) return null;
  return distanceKm({ lat: d.station.lat, lon: d.station.lon }, f) * 1000;
}

/** Départ détecté ? `onResume` : position lue au retour dans l'app (l'utilisateur est parti pendant ce temps). */
export function departed(d: Pick<DirectCharge, 'station'>, f: Fix, onResume = false): boolean {
  const m = distanceToStation(d, f);
  if (m == null || m <= AUTO_END_M) return false;
  return onResume || (f.speed ?? 0) >= DRIVING_MPS || m > FAR_M;
}

export function recordId(d: Pick<DirectCharge, 'chargeStartedAt' | 'openedAt' | 'station'>) {
  return `${d.chargeStartedAt ?? d.openedAt}-${d.station.id}`;
}

/** Reçu d'une recharge terminée (montants facultatifs saisis ensuite). */
export function recordOf(d: DirectCharge, endedAt: number, extra: Partial<ChargeRecord> = {}): ChargeRecord {
  const started = d.chargeStartedAt ?? d.openedAt;
  const input = {
    vehicle: d.plan?.vehicle ?? null,
    socPercent: d.plan?.socPercent ?? null,
    pointKw: d.plan?.pointKw ?? 0,
    plugs: d.plan?.plugs ?? (['t2'] as const).slice(),
    tariff: planTariff(d.plan),
  };
  const p = progressAt(input, (endedAt - started) / 60_000);
  return {
    id: recordId(d),
    startedAt: started,
    endedAt,
    stationId: d.station.id,
    stationName: d.station.name,
    operatorName: d.operatorName,
    pdcId: d.plan?.pdcId,
    method: d.plan?.method ?? (d.url ? 'scan' : 'reader'),
    kWh: p.kWhBilled,
    kWhEstimated: true,
    pricePaid: null,
    estimatedCost: p.cost,
    ok: null,
    vehicleName: d.plan?.vehicle?.name,
    startSoc: estimateCharge(input).fromSoc,
    endSoc: p.soc,
    ...extra,
  };
}

/** Termine automatiquement : heure de fin = dernier instant vu à la borne ; reçu déjà dans l'historique. */
export async function autoFinish(d: DirectCharge, now = Date.now()): Promise<DirectCharge> {
  const endedAt = Math.min(now, d.lastNearAt ?? now);
  await cancelAlerts(d.alertIds);
  // Échec d'écriture de l'historique : la recharge le garde (saveFailed) et l'écran l'affiche ; « Enregistrer » réessaie.
  const saved = await addRecord(recordOf(d, endedAt)).then(
    () => true,
    () => false,
  );
  await scheduleAlerts([{ at: now + 1500, title: tr().recharge.autoEndTitle, body: tr().recharge.autoEndBody(d.station.name) }]);
  return { ...d, endedAt, autoEnded: true, alertIds: [], ...(saved ? {} : { saveFailed: true }) };
}
