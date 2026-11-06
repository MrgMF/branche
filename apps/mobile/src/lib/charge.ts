import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { createSession, type Session } from './api';
import { displayName, type Station } from './stations';
import { tr } from '../i18n';

/** URL de retour après la page de paiement (app native ou site web). */
export function returnUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const base = (Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? '';
    return `${window.location.origin}${base}/session`;
  }
  return Linking.createURL('session');
}

/** Ouvre la page de paiement (pré-autorisation) puis affiche la session. */
export async function openCheckout(session: Pick<Session, 'id' | 'checkoutUrl'>) {
  if (Platform.OS === 'web') {
    window.location.assign(session.checkoutUrl);
    return;
  }
  await WebBrowser.openAuthSessionAsync(session.checkoutUrl, returnUrl());
  router.push({ pathname: '/session', params: { session: session.id } });
}

export async function startCharge(station: Station) {
  const s = await createSession({
    stationId: station.id,
    stationName: displayName(station),
    pdcId: station.pdc?.[0]?.[0],
    returnUrl: returnUrl(),
  });
  await openCheckout(s);
}

export function navigationLinks(s: Pick<Station, 'lat' | 'lon'>) {
  const ll = `${s.lat},${s.lon}`;
  const links = [
    { label: 'Waze', url: `https://waze.com/ul?ll=${ll}&navigate=yes` },
    { label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${ll}` },
  ];
  if (Platform.OS === 'ios') links.push({ label: tr().common.appleMaps, url: `https://maps.apple.com/?daddr=${ll}` });
  return links;
}
