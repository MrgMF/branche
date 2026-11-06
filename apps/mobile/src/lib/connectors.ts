// Connecteurs de paiement direct : l'utilisateur paie l'opérateur (lecteur de carte de la borne, ou page officielle
// ouverte dans l'app). Branché ne voit jamais les données de carte et n'encaisse rien.
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import { displayName, type Station } from './stations';
import { store, type ChargePlan, type DirectCharge } from './store';
import { tr } from '../i18n';

export { directPayUrl, operatorLabel, operatorOf, payOptions, type PayOption } from './methods';

export type ConnectorId = 'scan' | 'operator-link' | 'operator-app' | 'account' | 'reader' | 'badge';

function stationRef(station: Station | null) {
  return station
    ? { id: station.id, name: displayName(station), operator: station.o, ...(station.ok ? { ok: station.ok } : {}), tel: station.tel, lat: station.lat, lon: station.lon }
    : { id: 'inconnue', name: tr().common.scannedStation };
}

/** Démarre le suivi d'une recharge (avant confirmation du démarrage). */
export function beginCharge(url: string, station: Station | null, operatorName: string, extra: Partial<DirectCharge> = {}) {
  const p = store.plan();
  const plan = p && station && p.stationId === station.id ? p : null;
  store.setDirect({
    station: stationRef(station),
    operatorName,
    url,
    openedAt: Date.now(),
    chargeStartedAt: null,
    endedAt: null,
    ...(plan ? { plan } : {}),
    ...extra,
  });
}

/** Paiement par carte sur le lecteur de la borne : rien à ouvrir, suivi identique dans l'app. */
export function startReaderCharge(station: Station, operatorName: string) {
  beginCharge('', station, operatorName);
  router.push('/recharge');
}

/** Ouverture d'une page de paiement : ouverte, ou refusée faute de réseau (rien n'est démarré). */
export type OpenResult = 'opened' | 'offline';

/**
 * Ouvre l'appli officielle de l'opérateur via un lien PUBLIC (universal link ou schéma), sinon sa fiche de store si
 * l'appli n'est pas installée. Branché ne fait qu'amener au bon endroit : aucun identifiant transmis. true si une appli
 * ou une fiche de store s'est ouverte.
 */
export async function launchApp(open: string | null, store: string | null): Promise<boolean> {
  if (Platform.OS === 'web') {
    const target = open ?? store;
    if (!target) return false;
    window.open(target, '_blank', 'noopener,noreferrer');
    return true;
  }
  if (open) {
    try {
      if (await Linking.canOpenURL(open)) {
        await Linking.openURL(open);
        return true;
      }
    } catch {
      /* schéma non déclaré ou appli absente : repli sur la fiche de store */
    }
  }
  if (store) {
    try {
      await Linking.openURL(store);
      return true;
    } catch {
      /* rien à ouvrir */
    }
  }
  // Dernier recours : tenter le lien d'appli même si canOpenURL est faux (certains universal links s'ouvrent quand même).
  if (open) {
    try {
      await Linking.openURL(open);
      return true;
    } catch {
      /* rien à ouvrir */
    }
  }
  return false;
}

/**
 * Passerelle « Démarrer avec l'appli » : ouvre l'appli de l'opérateur (ou sa fiche de store), puis affiche le suivi.
 * Suivi identique au lecteur (url ''), `appLaunch` mémorisé pour rouvrir l'appli au besoin. 'offline' si rien n'a pu s'ouvrir.
 */
export async function openOperatorApp(open: string | null, store: string | null, station: Station | null, operatorName: string): Promise<OpenResult> {
  if (!(await launchApp(open, store))) return 'offline';
  beginCharge('', station, operatorName, { method: 'operator-app', appLaunch: { open, store } });
  router.push('/recharge');
  return 'opened';
}

/**
 * Réseau disponible pour ouvrir la page de l'opérateur ? Web : `navigator.onLine`, lu sans attendre (window.open doit
 * rester dans le geste de l'utilisateur, sinon le navigateur bloque la fenêtre). Natif : courte requête vers la page
 * elle-même ; toute réponse HTTP vaut « en ligne », seul un échec réseau (ou 3 s sans réponse) vaut « hors ligne ».
 */
export function offlineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
async function defaultProbe(url: string): Promise<boolean> {
  if (offlineNow()) return false;
  if (Platform.OS === 'web') return true;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    await fetch(url, { method: 'HEAD', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
let probe: (url: string) => Promise<boolean> = defaultProbe;
/** Tests : sonde réseau injectée. */
export function setNetworkProbe(p: ((url: string) => Promise<boolean>) | null) {
  probe = p ?? defaultProbe;
}

/**
 * Ouvre la page de paiement officielle dans le navigateur intégré, puis affiche le suivi de recharge.
 * Sans réseau : rien n'est ouvert ni suivi, 'offline' (l'écran affiche « Pas de réseau : payez au lecteur CB ou réessayez »).
 */
export async function openOperatorPayment(url: string, station: Station | null, operatorName: string, extra: Partial<DirectCharge> = {}): Promise<OpenResult> {
  if (Platform.OS === 'web') {
    if (offlineNow()) return 'offline';
    beginCharge(url, station, operatorName, extra);
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    if (!(await probe(url))) return 'offline';
    beginCharge(url, station, operatorName, extra);
    // SFSafariViewController / Chrome Custom Tabs : page de l'opérateur telle quelle, cookies isolés de l'app.
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      enableBarCollapsing: true,
      showTitle: true,
    });
  }
  router.push('/recharge');
  return 'opened';
}

/** Exécute un plan choisi (parcours « Recharger » ou recharge préparée) : un seul geste à la borne. */
export async function runPlan(station: Station, plan: ChargePlan, operatorName: string, url?: string, appStore?: string): Promise<OpenResult> {
  store.setCurrent(station);
  store.setPlan(plan);
  if (plan.method === 'reader' || plan.method === 'badge') startReaderCharge(station, operatorName);
  else if (plan.method === 'operator-app') return openOperatorApp(url ?? null, appStore ?? null, station, operatorName);
  else if (plan.method === 'account' && url) {
    // Compte imposé par l'opérateur : jamais « connecté » à l'ouverture du site. Au retour, le suivi demande
    // « Êtes-vous connecté à votre compte X ? » (comme Mes comptes) ; seul un « oui » est retenu, puis réutilisé.
    return openOperatorPayment(url, station, operatorName, station.ok ? { accountAsk: { key: station.ok, name: operatorName } } : {});
  } else if (plan.method === 'operator-link' && url) return openOperatorPayment(url, station, operatorName);
  else router.push({ pathname: '/payer', params: { from: 'recharger' } });
  return 'opened';
}
