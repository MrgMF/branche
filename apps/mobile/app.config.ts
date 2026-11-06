import type { ExpoConfig } from 'expo/config';
import vehicleApps from './src/lib/vehicle-apps.json';

// Variables injectées au build (CI GitHub Actions ou EAS) :
// BASE_URL : sous-chemin web (ex. /branche/app) · DATA_URL : base des tuiles IRVE · API_URL : API de paiement (vide = paiement in-app désactivé)
const baseUrl = process.env.BASE_URL ?? '';
if (process.env.EAS_BUILD && [process.env.DATA_URL, process.env.SITE_URL, process.env.API_URL].some((v) => !v || v.includes('REPLACE_ME'))) {
  throw new Error('eas.json : remplacez REPLACE_ME par votre identifiant GitHub (DATA_URL, SITE_URL) et l’URL de votre API Render (API_URL) avant de lancer un build.');
}
// Un seul texte d'autorisation (iOS n'en garde qu'un, partagé par expo-camera et expo-image-picker) couvrant tous les usages.
const CAMERA_TEXT =
  'Branché utilise l’appareil photo pour lire le QR code de la borne (analysé sur votre téléphone, jamais enregistré ni envoyé) et, si vous le souhaitez, pour reconnaître votre véhicule (photo envoyée pour l’identification puis oubliée) ou photographier le ticket de recharge (gardé uniquement sur votre téléphone).';
const config: ExpoConfig = {
  name: 'Branché',
  slug: 'branche',
  scheme: 'branche',
  version: '1.0.0',
  // Portrait et paysage (support voiture) : le guidage a une mise en page paysage (bandeau à gauche, carte à droite).
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'app.branche.mobile',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Branché utilise votre position pour trouver la borne la plus proche, sur votre appareil. Elle n’est envoyée à nos serveurs que si vous demandez un itinéraire ou faites un signalement.',
      ITSAppUsesNonExemptEncryption: false,
      // Guidage écran verrouillé (avec accord explicite, pendant un guidage seulement) : position et voix en arrière-plan.
      UIBackgroundModes: ['location', 'audio'],
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
    // Langue de l'appareil (src/i18n/device.ts)
    'expo-localization',
    // Rappels locaux de fin de charge et avant pénalité d'occupation (aucune notification distante)
    ['expo-notifications', { color: '#0B7A55' }],
    // Véhicule : photo facultative (envoyée pour identification, jamais conservée) ; ticket de recharge (local uniquement) ; marques des applis constructeur (<queries>)
    ['expo-image-picker', { cameraPermission: CAMERA_TEXT, photosPermission: false, microphonePermission: false }],
    ['./plugins/withVehicleAppQueries', { packages: (vehicleApps.android as { package: string }[]).map((a) => a.package) }],
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: '#FFFFFF' }],
    ['expo-camera', { cameraPermission: CAMERA_TEXT, recordAudioAndroid: false }],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Branché utilise votre position pour trouver la borne la plus proche, sur votre appareil. Elle n’est envoyée à nos serveurs que si vous demandez un itinéraire ou faites un signalement.',
        // Demandée seulement au démarrage d'un guidage, après un écran d'explication.
        locationAlwaysAndWhenInUsePermission:
          'Pendant un guidage seulement, Branché utilise votre position écran verrouillé pour continuer à vous guider à la voix, jusqu’à l’arrivée. Elle n’est pas enregistrée.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  experiments: { typedRoutes: false, ...(baseUrl ? { baseUrl } : {}) },
  extra: {
    dataUrl: process.env.DATA_URL ?? 'https://REPLACE_ME.github.io/branche/data',
    apiUrl: process.env.API_URL ?? '',
    siteUrl: process.env.SITE_URL ?? 'https://REPLACE_ME.github.io/branche',
    // Développement / tests E2E uniquement : hôtes http de CPO de test acceptés par le scanner.
    devHosts: (process.env.DEV_TRUSTED_HOSTS ?? '').split(',').map((h: string) => h.trim()).filter(Boolean),
  },
};
export default config;
