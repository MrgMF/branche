// État partagé entre écrans ; la recharge payée chez l'opérateur est persistée
// (l'app peut être fermée pendant que la page de paiement est ouverte).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Station } from './stations';

export interface DirectCharge {
  station: { id: string; name: string; operator?: string; tel?: string };
  operatorName: string;
  url: string;
  openedAt: number;
  chargeStartedAt: number | null;
  endedAt: number | null;
}

const KEY = 'branche.direct.v1';
let stations: Station[] = [];
let current: Station | null = null;
let direct: DirectCharge | null = null;

export const store = {
  setStations: (list: Station[]) => {
    stations = list;
  },
  stations: () => stations,
  setCurrent: (s: Station | null) => {
    current = s;
  },
  current: () => current,
  setDirect: (d: DirectCharge | null) => {
    direct = d;
    (d ? AsyncStorage.setItem(KEY, JSON.stringify(d)) : AsyncStorage.removeItem(KEY)).catch(() => undefined);
  },
  direct: () => direct,
  async loadDirect(): Promise<DirectCharge | null> {
    if (direct) return direct;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      direct = raw ? (JSON.parse(raw) as DirectCharge) : null;
    } catch {
      direct = null;
    }
    // Une recharge abandonnée depuis plus de 24 h n'est plus proposée
    if (direct && Date.now() - direct.openedAt > 24 * 3600 * 1000) store.setDirect(null);
    return direct;
  },
};
