import Constants from 'expo-constants';

type Extra = { dataUrl?: string; apiUrl?: string; siteUrl?: string; devHosts?: string[] };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

const trim = (s?: string) => (s ?? '').replace(/\/+$/, '');

export const DATA_URL = trim(extra.dataUrl);
export const API_URL = trim(extra.apiUrl);
export const SITE_URL = trim(extra.siteUrl);
export const DEV_HOSTS = extra.devHosts ?? [];
export const LEGAL = {
  cgu: `${SITE_URL}/legal/cgu.html`,
  confidentialite: `${SITE_URL}/legal/confidentialite.html`,
  mentions: `${SITE_URL}/legal/mentions-legales.html`,
};
/** Position par défaut si la localisation est refusée : Paris. */
export const DEFAULT_CENTER = { lat: 48.8566, lon: 2.3522 };
