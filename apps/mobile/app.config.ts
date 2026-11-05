import type { ExpoConfig } from 'expo/config';

// Variables injectées au build (CI GitHub Actions ou EAS) :
// BASE_URL : sous-chemin web (ex. /branche/app) · DATA_URL : base des tuiles IRVE · API_URL : API de paiement (vide = paiement in-app désactivé)
const baseUrl = process.env.BASE_URL ?? '';
if (process.env.EAS_BUILD && [process.env.DATA_URL, process.env.SITE_URL, process.env.API_URL].some((v) => !v || v.includes('REPLACE_ME'))) {
  throw new Error('eas.json : remplacez REPLACE_ME par votre identifiant GitHub (DATA_URL, SITE_URL) et l’URL de votre API Render (API_URL) avant de lancer un build.');
}
const config: ExpoConfig = {
  name: 'Branché',
  slug: 'branche',
  scheme: 'branche',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'app.branche.mobile',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Branché utilise votre position pour trouver la borne la plus proche. Le calcul se fait sur votre appareil : votre position n’est jamais envoyée à nos serveurs.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'app.branche.mobile',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B7A55' },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png', output: 'single', bundler: 'metro', name: 'Branché', themeColor: '#0B7A55' },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-web-browser',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: '#FFFFFF' }],
    [
      'expo-location',
      { locationWhenInUsePermission: 'Branché utilise votre position pour trouver la borne la plus proche. Le calcul se fait sur votre appareil : votre position n’est jamais envoyée à nos serveurs.' },
    ],
  ],
  experiments: { typedRoutes: false, ...(baseUrl ? { baseUrl } : {}) },
  extra: {
    dataUrl: process.env.DATA_URL ?? 'https://REPLACE_ME.github.io/branche/data',
    apiUrl: process.env.API_URL ?? '',
    siteUrl: process.env.SITE_URL ?? 'https://REPLACE_ME.github.io/branche',
  },
};
export default config;
