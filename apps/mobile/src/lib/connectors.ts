// Connecteurs de paiement direct : l'utilisateur paie l'opérateur (lecteur de carte de la borne, ou page officielle
// ouverte dans l'app). Branché ne voit jamais les données de carte et n'encaisse rien.
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { displayName, type Station } from './stations';
import { store, type ChargePlan, type DirectCharge } from './store';
import { tr } from '../i18n';

export { directPayUrl, operatorLabel, operatorOf, payOptions, type PayOption } from './methods';

export type ConnectorId = 'scan' | 'operator-link' | 'account' | 'reader' | 'badge';

function stationRef(station: Station | null) {
  return station
    ? { id: station.id, name: displayName(station), operator: station.o, tel: station.tel, lat: station.lat, lon: station.lon }
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

/** Ouvre la page de paiement officielle dans le navigateur intégré, puis affiche le suivi de recharge. */
export async function openOperatorPayment(url: string, station: Station | null, operatorName: string, extra: Partial<DirectCharge> = {}) {
  beginCharge(url, station, operatorName, extra);
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    // SFSafariViewController / Chrome Custom Tabs : page de l'opérateur telle quelle, cookies isolés de l'app.
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      enableBarCollapsing: true,
      showTitle: true,
    });
  }
  router.push('/recharge');
}

/** Exécute un plan choisi (parcours « Recharger » ou recharge préparée) : un seul geste à la borne. */
export function runPlan(station: Station, plan: ChargePlan, operatorName: string, url?: string) {
  store.setCurrent(station);
  store.setPlan(plan);
  if (plan.method === 'reader' || plan.method === 'badge') startReaderCharge(station, operatorName);
  else if (plan.method === 'account' && url) {
    // Compte imposé par l'opérateur : jamais « connecté » à l'ouverture du site. Au retour, le suivi demande
    // « Êtes-vous connecté à votre compte X ? » (comme Mes comptes) ; seul un « oui » est retenu, puis réutilisé.
    openOperatorPayment(url, station, operatorName, station.ok ? { accountAsk: { key: station.ok, name: operatorName } } : {});
  } else if (plan.method === 'operator-link' && url) openOperatorPayment(url, station, operatorName);
  else router.push({ pathname: '/payer', params: { from: 'recharger' } });
}
