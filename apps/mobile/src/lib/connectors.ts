// Connecteurs de paiement direct : l'utilisateur paie l'opérateur sur sa page officielle, ouverte dans l'app.
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { operatorPayUrl, type Operator } from './qr';
import { displayName, type Station } from './stations';
import { store } from './store';

export type ConnectorId = 'scan' | 'operator-link' | 'branche-card' | 'branche-pay';

export function operatorOf(s: Station | null, ops: Operator[]): Operator | undefined {
  return s?.ok ? ops.find((o) => o.key === s.ok) : undefined;
}

export function operatorLabel(s: Station | null, ops: Operator[]): string {
  return operatorOf(s, ops)?.names[0] ?? s?.o?.split('|')[0]?.trim() ?? 'l’opérateur';
}

/** URL de paiement ad hoc connue pour cette borne (gabarit vérifié du registre). */
export function directPayUrl(s: Station, ops: Operator[]): string | null {
  return operatorPayUrl(operatorOf(s, ops), s.pdc?.[0]?.[0]);
}

/** Ouvre la page de paiement officielle dans le navigateur intégré, puis affiche le suivi de recharge. */
export async function openOperatorPayment(url: string, station: Station | null, operatorName: string) {
  store.setDirect({
    station: station
      ? { id: station.id, name: displayName(station), operator: station.o, tel: station.tel }
      : { id: 'inconnue', name: 'Borne scannée' },
    operatorName,
    url,
    startedAt: Date.now(),
  });
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
