// Connecteurs de paiement direct : l'utilisateur paie l'opérateur (lecteur de carte de la borne, ou page officielle
// ouverte dans l'app). Branché ne voit jamais les données de carte et n'encaisse rien.
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { displayName, type Station } from './stations';
import { markConnected } from './accounts';
import { store, type ChargePlan } from './store';

export { directPayUrl, operatorLabel, operatorOf, payOptions, type PayOption } from './methods';

export type ConnectorId = 'scan' | 'operator-link' | 'account' | 'reader' | 'badge';

function stationRef(station: Station | null) {
  return station
    ? { id: station.id, name: displayName(station), operator: station.o, tel: station.tel, lat: station.lat, lon: station.lon }
    : { id: 'inconnue', name: 'Borne scannée' };
}

/** Démarre le suivi d'une recharge (avant confirmation du démarrage). */
export function beginCharge(url: string, station: Station | null, operatorName: string) {
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
  });
}

/** Paiement par carte sur le lecteur de la borne : rien à ouvrir, suivi identique dans l'app. */
export function startReaderCharge(station: Station, operatorName: string) {
  beginCharge('', station, operatorName);
  router.push('/recharge');
}

/** Ouvre la page de paiement officielle dans le navigateur intégré, puis affiche le suivi de recharge. */
export async function openOperatorPayment(url: string, station: Station | null, operatorName: string) {
  beginCharge(url, station, operatorName);
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    // SFSafariViewController / Chrome Custom Tabs : Apple Pay et Google Pay disponibles, cookies isolés de l'app.
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
  // Compte imposé par l'opérateur : ajouté une fois (sur son site, dans le navigateur intégré), réutilisé ensuite
  if (plan.method === 'account' && station.ok) markConnected(station.ok, operatorName);
  if (plan.method === 'reader' || plan.method === 'badge') startReaderCharge(station, operatorName);
  else if ((plan.method === 'operator-link' || plan.method === 'account') && url) openOperatorPayment(url, station, operatorName);
  else router.push({ pathname: '/payer', params: { from: 'recharger' } });
}
