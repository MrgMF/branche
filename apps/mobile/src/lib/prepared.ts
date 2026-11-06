// « Préparer ma recharge » : point, méthode et estimation validés avant d'arriver, gardés sur l'appareil.
// À l'arrivée (< 60 m), un seul geste : « Payer maintenant ». Rien n'est débité à l'avance (pas de contrat d'itinérance).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Station } from './stations';
import type { ChargePlan } from './store';

export interface Prepared {
  station: Station;
  plan: ChargePlan;
  operatorName: string;
  url?: string;
  /** Coût estimé au moment de la préparation (€), null si prix inconnu. */
  estimatedCost: number | null;
  createdAt: number;
}

const KEY = 'branche.prepared.v1';
const MAX_AGE = 48 * 3600_000;
let cache: Prepared | null | undefined;

export async function loadPrepared(): Promise<Prepared | null> {
  if (cache !== undefined) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Prepared) : null;
  } catch {
    cache = null;
  }
  if (cache && Date.now() - cache.createdAt > MAX_AGE) await clearPrepared();
  return cache ?? null;
}

export async function savePrepared(p: Prepared): Promise<void> {
  cache = p;
  await AsyncStorage.setItem(KEY, JSON.stringify(p)).catch(() => undefined);
}

export async function clearPrepared(): Promise<void> {
  cache = null;
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}
