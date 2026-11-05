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

// Valeurs INDICATIVES (fiches constructeurs et essais publics) : batterie utile, conso mixte, puissances maximales.
// La puissance réelle dépend de la température, de l'état de charge et de la borne.
export const VEHICLES: VehicleModel[] = [
  { id: 'renault-5-52', name: 'Renault 5 E-Tech 52 kWh', batteryKWh: 52, consumptionKWhPer100: 15, maxDcKW: 100, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'renault-zoe-52', name: 'Renault Zoe R135 52 kWh', batteryKWh: 52, consumptionKWhPer100: 17, maxDcKW: 50, maxAcKW: 22, plugs: ['ccs', 't2'] },
  { id: 'renault-megane-60', name: 'Renault Mégane E-Tech 60 kWh', batteryKWh: 60, consumptionKWhPer100: 16.5, maxDcKW: 130, maxAcKW: 22, plugs: ['ccs', 't2'] },
  { id: 'renault-scenic-87', name: 'Renault Scenic E-Tech 87 kWh', batteryKWh: 87, consumptionKWhPer100: 17, maxDcKW: 150, maxAcKW: 22, plugs: ['ccs', 't2'] },
  { id: 'dacia-spring', name: 'Dacia Spring', batteryKWh: 26.8, consumptionKWhPer100: 14, maxDcKW: 30, maxAcKW: 7, plugs: ['ccs', 't2'] },
  { id: 'peugeot-e208', name: 'Peugeot e-208 (51 kWh)', batteryKWh: 48.1, consumptionKWhPer100: 15, maxDcKW: 100, maxAcKW: 7.4, plugs: ['ccs', 't2'] },
  { id: 'peugeot-e2008', name: 'Peugeot e-2008 (54 kWh)', batteryKWh: 51, consumptionKWhPer100: 17, maxDcKW: 100, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'peugeot-e3008', name: 'Peugeot e-3008 73 kWh', batteryKWh: 73, consumptionKWhPer100: 17.5, maxDcKW: 160, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'citroen-ec3', name: 'Citroën ë-C3 44 kWh', batteryKWh: 44, consumptionKWhPer100: 16, maxDcKW: 100, maxAcKW: 7.4, plugs: ['ccs', 't2'] },
  { id: 'citroen-ec4', name: 'Citroën ë-C4 (54 kWh)', batteryKWh: 51, consumptionKWhPer100: 16.5, maxDcKW: 100, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'opel-corsa-e', name: 'Opel Corsa Electric (51 kWh)', batteryKWh: 48.1, consumptionKWhPer100: 15.5, maxDcKW: 100, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'fiat-500e', name: 'Fiat 500e 42 kWh', batteryKWh: 37.3, consumptionKWhPer100: 14.5, maxDcKW: 85, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'tesla-m3-rwd', name: 'Tesla Model 3 Propulsion', batteryKWh: 57.5, consumptionKWhPer100: 14, maxDcKW: 170, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'tesla-m3-lr', name: 'Tesla Model 3 Grande Autonomie', batteryKWh: 75, consumptionKWhPer100: 15, maxDcKW: 250, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'tesla-my-rwd', name: 'Tesla Model Y Propulsion', batteryKWh: 60, consumptionKWhPer100: 15.5, maxDcKW: 175, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'tesla-my-lr', name: 'Tesla Model Y Grande Autonomie', batteryKWh: 75, consumptionKWhPer100: 16.5, maxDcKW: 250, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'mg4-64', name: 'MG4 Electric 64 kWh', batteryKWh: 61.7, consumptionKWhPer100: 16.5, maxDcKW: 135, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'vw-id3-58', name: 'Volkswagen ID.3 Pro 58 kWh', batteryKWh: 58, consumptionKWhPer100: 16, maxDcKW: 120, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'vw-id4-77', name: 'Volkswagen ID.4 Pro 77 kWh', batteryKWh: 77, consumptionKWhPer100: 18, maxDcKW: 135, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'skoda-enyaq-85', name: 'Skoda Enyaq 85', batteryKWh: 77, consumptionKWhPer100: 17.5, maxDcKW: 135, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'kia-niro-ev', name: 'Kia Niro EV 64,8 kWh', batteryKWh: 64.8, consumptionKWhPer100: 16, maxDcKW: 80, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'kia-ev3-81', name: 'Kia EV3 81 kWh', batteryKWh: 78, consumptionKWhPer100: 15.5, maxDcKW: 128, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'kia-ev6-77', name: 'Kia EV6 77 kWh', batteryKWh: 74, consumptionKWhPer100: 18, maxDcKW: 240, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'hyundai-kona-65', name: 'Hyundai Kona Electric 65 kWh', batteryKWh: 64.8, consumptionKWhPer100: 15.5, maxDcKW: 100, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'hyundai-ioniq5-77', name: 'Hyundai Ioniq 5 77 kWh', batteryKWh: 74, consumptionKWhPer100: 18, maxDcKW: 230, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'byd-atto3', name: 'BYD Atto 3', batteryKWh: 60.5, consumptionKWhPer100: 17, maxDcKW: 88, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'volvo-ex30', name: 'Volvo EX30 69 kWh', batteryKWh: 64, consumptionKWhPer100: 17, maxDcKW: 153, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'mini-cooper-e', name: 'Mini Cooper SE électrique', batteryKWh: 49.2, consumptionKWhPer100: 15, maxDcKW: 95, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'bmw-ix1', name: 'BMW iX1 eDrive20', batteryKWh: 64.7, consumptionKWhPer100: 17, maxDcKW: 130, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'mercedes-eqa', name: 'Mercedes EQA 250+', batteryKWh: 70.5, consumptionKWhPer100: 17, maxDcKW: 100, maxAcKW: 11, plugs: ['ccs', 't2'] },
  { id: 'nissan-leaf-40', name: 'Nissan Leaf 40 kWh', batteryKWh: 39, consumptionKWhPer100: 16, maxDcKW: 46, maxAcKW: 6.6, plugs: ['chademo', 't2'] },
];

/** Profil générique quand le véhicule n'est pas renseigné (estimation prudente, signalée comme telle). */
export const GENERIC_VEHICLE: VehicleModel = {
  id: 'generique',
  name: 'Véhicule électrique moyen',
  batteryKWh: 55,
  consumptionKWhPer100: 16.5,
  maxDcKW: 100,
  maxAcKW: 11,
  plugs: ['ccs', 't2'],
};

export const VEHICLE_SOURCE_NOTE = 'Valeurs indicatives publiques ; la recharge réelle dépend de la borne, de la température et de la batterie.';

/** Le véhicule peut-il se brancher sur l'une de ces prises ? (sans véhicule : oui) */
export function compatible(plugs: Plug[], v: Pick<VehicleModel, 'plugs'> | null | undefined): boolean {
  if (!v) return true;
  if (!plugs.length) return true; // prise inconnue : on ne masque pas
  return plugs.some((p) => v.plugs.includes(p) || (p === 't2' && v.plugs.includes('t2')));
}

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
