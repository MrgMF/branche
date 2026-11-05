// Profil véhicule local (aucun compte). Partagé par le paiement (estimation) et la navigation (batterie à l'arrivée).
// Contrat figé : l'équipe paiement complète VEHICLES et l'écran de saisie ; la navigation ne fait que lire.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Plug } from './stations';

export interface VehicleModel {
  id: string;
  name: string; // « Renault Mégane E-Tech 60 kWh »
  batteryKWh: number; // capacité utile
  consumptionKWhPer100: number; // conso mixte réaliste
  maxDcKW: number; // 0 si pas de charge rapide
  maxAcKW: number;
  plugs: Plug[];
}

export interface Vehicle extends VehicleModel {
  socPercent: number; // charge estimée actuelle, saisie par l'utilisateur
  socUpdatedAt: number;
}

export const VEHICLES: VehicleModel[] = [];

const KEY = 'branche.vehicle.v1';
let cached: Vehicle | null | undefined;

export async function loadVehicle(): Promise<Vehicle | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as Vehicle) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function saveVehicle(v: Vehicle | null): Promise<void> {
  cached = v;
  try {
    await (v ? AsyncStorage.setItem(KEY, JSON.stringify(v)) : AsyncStorage.removeItem(KEY));
  } catch {
    /* stockage indisponible : profil gardé en mémoire */
  }
}

/** Autonomie restante estimée (km) pour un état de charge donné. */
export function rangeKm(v: Pick<Vehicle, 'batteryKWh' | 'consumptionKWhPer100'>, socPercent: number): number {
  return Math.max(0, ((v.batteryKWh * socPercent) / 100 / v.consumptionKWhPer100) * 100);
}

/** État de charge estimé après `distanceM` (conso +15 % au-delà de 110 km/h moyen non modélisé : marge appliquée par l'appelant). */
export function socAfter(v: Pick<Vehicle, 'batteryKWh' | 'consumptionKWhPer100'>, socPercent: number, distanceM: number): number {
  const used = ((distanceM / 1000) * v.consumptionKWhPer100) / 100;
  return socPercent - (used / v.batteryKWh) * 100;
}
