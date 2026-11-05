// État partagé entre écrans ; la recharge en cours est persistée (l'app peut être fermée pendant
// que la page de paiement est ouverte ou pendant la charge) et reprise à la réouverture.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MethodId } from './history';
import type { Plug, Station } from './stations';

/** Ce que l'utilisateur a choisi dans le parcours « Recharger » (point, méthode, véhicule, tarif). */
export interface ChargePlan {
  stationId: string;
  pdcId?: string;
  pointKw: number;
  plugs: Plug[];
  method: MethodId;
  /** Batterie au branchement (%), null si inconnue. */
  socPercent: number | null;
  vehicle: { name: string; batteryKWh: number; maxDcKW: number; maxAcKW: number } | null;
  /** Texte IRVE `tarification` (analysé à l'affichage) et gratuité. */
  tariffRaw?: string;
  free?: boolean;
}

export interface DirectCharge {
  station: { id: string; name: string; operator?: string; tel?: string; lat?: number; lon?: number };
  operatorName: string;
  /** Page de paiement de l'opérateur ('' pour un paiement par carte au lecteur). */
  url: string;
  openedAt: number;
  chargeStartedAt: number | null;
  endedAt: number | null;
  plan?: ChargePlan;
  /** Notifications locales programmées (fin à 80 %, avant pénalité). */
  alertIds?: string[];
  /** Dernière position connue à la borne (heure de départ estimée en cas de fin automatique). */
  lastNearAt?: number;
  /** Fin détectée automatiquement (départ de la borne). */
  autoEnded?: boolean;
}

const KEY = 'branche.direct.v1';
let stations: Station[] = [];
let current: Station | null = null;
let direct: DirectCharge | null = null;
let plan: ChargePlan | null = null;

export const store = {
  setStations: (list: Station[]) => {
    stations = list;
  },
  stations: () => stations,
  setCurrent: (s: Station | null) => {
    current = s;
  },
  current: () => current,
  /** Choix en cours dans le parcours de recharge (mémoire seulement, recopié dans DirectCharge au paiement). */
  setPlan: (p: ChargePlan | null) => {
    plan = p;
  },
  plan: () => plan,
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
