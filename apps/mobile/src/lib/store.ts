// État partagé entre écrans ; la recharge en cours est persistée (l'app peut être fermée pendant
// que la page de paiement est ouverte ou pendant la charge) et reprise à la réouverture.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settleStale } from './autoEnd';
import type { MethodId } from './history';
import type { PayMethod, Plug, Station } from './stations';

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
  /** Puissance max. de la station et moyens de paiement IRVE : pour juger la gratuité déclarée (tariff.ts freeCredible). */
  stationKw?: number;
  pay?: PayMethod[];
}

export interface DirectCharge {
  /** `ok` : clé de l'opérateur (operator-portals.json), pour relire sa saisie du point (idEntry) dans le suivi. */
  station: { id: string; name: string; operator?: string; ok?: string; tel?: string; lat?: number; lon?: number };
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
  /** Fin détectée automatiquement (départ de la borne, ou recharge jamais terminée depuis plus de 24 h). */
  autoEnded?: boolean;
  /** Origine de la fin automatique : départ constaté, ou recharge restée ouverte plus de 24 h (fin estimée). */
  autoReason?: 'departed' | 'stale';
  /** Méthode réellement utilisée au moment du paiement (reprise par le reçu, prioritaire sur celle du plan). */
  method?: MethodId;
  /** Compte opérateur ouvert pour démarrer : à confirmer par l'utilisateur au retour (jamais supposé connecté). */
  accountAsk?: { key: string; name: string };
  /** Le reçu (fin automatique) n'a pas pu être écrit dans l'historique : affiché, « Enregistrer » réessaie. */
  saveFailed?: boolean;
  /** « Toujours en cours » répondu à « Abandonner ce paiement ? » : question reposée 6 h plus tard. */
  stillOnAt?: number;
}

/** Paiement ouvert dont le démarrage n'est jamais confirmé : au-delà de 6 h, l'accueil demande « Abandonner ce paiement ? ». */
export const STALE_UNCONFIRMED_MS = 6 * 3600_000;
export function staleUnconfirmed(d: DirectCharge | null, now = Date.now()): d is DirectCharge {
  return !!d && !d.chargeStartedAt && !d.endedAt && now - Math.max(d.openedAt, d.stillOnAt ?? 0) > STALE_UNCONFIRMED_MS;
}

const KEY = 'branche.direct.v1';
/** Borne sélectionnée et parcours « Recharger » en cours : persistés pour survivre à un rechargement de la page. */
const CTX_KEY = 'branche.context.v1';
/** Contexte trop ancien : ignoré au rechargement (jamais de paiement sur un choix de la veille). */
export const CONTEXT_TTL_MS = 12 * 3600_000;
let stations: Station[] = [];
let current: Station | null = null;
let direct: DirectCharge | null = null;
let plan: ChargePlan | null = null;
let persistFailed = false;
const persistListeners = new Set<() => void>();
let hydrated: Promise<{ current: Station | null; plan: ChargePlan | null }> | null = null;

function saveContext() {
  const v = current || plan ? JSON.stringify({ at: Date.now(), current, plan }) : null;
  (v ? AsyncStorage.setItem(CTX_KEY, v) : AsyncStorage.removeItem(CTX_KEY)).catch(() => undefined);
}

export const store = {
  setStations: (list: Station[]) => {
    stations = list;
  },
  stations: () => stations,
  setCurrent: (s: Station | null) => {
    current = s;
    saveContext();
  },
  current: () => current,
  /** Choix en cours dans le parcours de recharge (persisté avec la borne, recopié dans DirectCharge au paiement). */
  setPlan: (p: ChargePlan | null) => {
    plan = p;
    saveContext();
  },
  plan: () => plan,
  /**
   * Après un rechargement (mémoire vide) : borne et plan relus sur l'appareil, s'ils datent de moins de 12 h.
   * Ne remplace jamais un choix déjà en mémoire.
   */
  hydrate(): Promise<{ current: Station | null; plan: ChargePlan | null }> {
    if (!hydrated) {
      hydrated = AsyncStorage.getItem(CTX_KEY)
        .then((raw) => {
          const v = raw ? (JSON.parse(raw) as { at?: number; current?: Station | null; plan?: ChargePlan | null }) : null;
          const fresh = !!v && typeof v.at === 'number' && Date.now() - v.at < CONTEXT_TTL_MS;
          if (fresh && !current && v.current?.id) current = v.current;
          if (fresh && !plan && v.plan?.stationId) plan = v.plan;
        })
        .catch(() => undefined)
        .then(() => ({ current, plan }));
    }
    return hydrated;
  },
  setDirect: (d: DirectCharge | null) => {
    direct = d;
    persistFailed = false;
    (d ? AsyncStorage.setItem(KEY, JSON.stringify(d)) : AsyncStorage.removeItem(KEY)).catch(() => {
      // Recharge non sauvegardée sur l'appareil (stockage plein) : signalée à l'écran de suivi
      persistFailed = true;
      persistListeners.forEach((l) => l());
    });
  },
  /** La dernière sauvegarde de la recharge en cours a échoué (l'app fermée la perdrait). */
  directPersistFailed: () => persistFailed,
  onDirectPersistError(l: () => void) {
    persistListeners.add(l);
    return () => void persistListeners.delete(l);
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
    // Rien n'est effacé en silence : une recharge démarrée jamais terminée depuis plus de 24 h est terminée (fin estimée)
    // et archivée avec son reçu ; une recharge terminée depuis plus de 24 h n'est retirée qu'une fois son reçu archivé.
    // Un paiement jamais confirmé : l'accueil demande « Abandonner ce paiement ? » (archivé « non démarré » si oui).
    if (direct) {
      const before = direct;
      const next = await settleStale(before);
      if (next !== before && direct === before) store.setDirect(next);
    }
    return direct;
  },
  /** Tests : simule un rechargement de l'app (mémoire vidée, stockage de l'appareil conservé). */
  _resetMemory() {
    stations = [];
    current = null;
    direct = null;
    plan = null;
    hydrated = null;
  },
};
