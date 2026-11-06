// Suivi de position multiplateforme. Sur le web, navigator.geolocation directement : le watchPositionAsync
// d'expo-location (SDK 58) remplace son identifiant d'abonnement par celui du navigateur, ce qui perd les
// rappels dès que deux suivis coexistent et n'appelle jamais clearWatch.
// Natif, pendant le guidage seulement et avec l'accord explicite du conducteur : suivi en arrière-plan
// (expo-location startLocationUpdatesAsync + expo-task-manager) pour continuer la voix écran verrouillé.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export interface GeoSample {
  lat: number;
  lon: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  t: number;
}

const toSample = (p: Location.LocationObject): GeoSample => ({
  lat: p.coords.latitude,
  lon: p.coords.longitude,
  accuracy: p.coords.accuracy ?? null,
  heading: p.coords.heading ?? null,
  speed: p.coords.speed ?? null,
  t: p.timestamp || Date.now(),
});

export async function watchGeo(cb: (s: GeoSample) => void, onError?: (code: 'denied' | 'unavailable') => void, precise = true): Promise<{ remove: () => void }> {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError?.('unavailable');
      return { remove: () => undefined };
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        cb({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy ?? null,
          heading: p.coords.heading ?? null,
          speed: p.coords.speed ?? null,
          t: p.timestamp || Date.now(),
        }),
      (e) => onError?.(e.code === 1 ? 'denied' : 'unavailable'),
      { enableHighAccuracy: precise, maximumAge: 1000, timeout: 20000 },
    );
    return { remove: () => navigator.geolocation.clearWatch(id) };
  }
  const sub = await Location.watchPositionAsync(
    { accuracy: precise ? Location.Accuracy.BestForNavigation : Location.Accuracy.High, distanceInterval: 3, timeInterval: 1000 },
    (p) => cb(toSample(p)),
  );
  return sub;
}

// ---------------------------------------------------------------- Arrière-plan (natif, guidage)

export const NAV_TASK = 'branche-nav-location';
let bgListener: ((s: GeoSample) => void) | null = null;

// Tâche déclarée au chargement du module (exigence d'expo-task-manager : portée globale).
if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(NAV_TASK, async ({ data, error }) => {
    if (error || !data?.locations) return;
    for (const p of data.locations) bgListener?.(toSample(p));
  });
}

const CONSENT_KEY = 'branche.nav.background.v1';
export type BgConsent = 'web' | 'granted' | 'declined' | 'ask';

/** État du consentement « position en arrière-plan pendant le guidage ». */
export async function backgroundConsent(): Promise<BgConsent> {
  if (Platform.OS === 'web') return 'web';
  const perm = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (perm?.status === 'granted') return 'granted';
  const stored = await AsyncStorage.getItem(CONSENT_KEY).catch(() => null);
  return stored === 'declined' ? 'declined' : 'ask';
}

/** Demande la permission « toujours » (après l'écran d'explication). */
export async function requestBackground(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (fg?.status !== 'granted') {
    const asked = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (asked?.status !== 'granted') return false;
  }
  const res = await Location.requestBackgroundPermissionsAsync().catch(() => null);
  const ok = res?.status === 'granted';
  await AsyncStorage.setItem(CONSENT_KEY, ok ? 'granted' : 'declined').catch(() => undefined);
  return ok;
}

export const declineBackground = () => AsyncStorage.setItem(CONSENT_KEY, 'declined').catch(() => undefined);

/**
 * Suivi en arrière-plan pendant le guidage (null si indisponible ou non autorisé : le suivi au premier plan prend le relais).
 * Android : service au premier plan avec notification permanente « Guidage en cours ». iOS : indicateur bleu de localisation.
 */
export async function watchGeoBackground(cb: (s: GeoSample) => void, notification: { title: string; body: string }): Promise<{ remove: () => void } | null> {
  if (Platform.OS === 'web') return null;
  const perm = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (perm?.status !== 'granted') return null;
  try {
    bgListener = cb;
    await Location.startLocationUpdatesAsync(NAV_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 3,
      timeInterval: 1000,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: notification.title, notificationBody: notification.body, notificationColor: '#0B7A55', killServiceOnDestroy: true },
    });
  } catch {
    bgListener = null;
    return null;
  }
  return {
    remove: () => {
      bgListener = null;
      Location.hasStartedLocationUpdatesAsync(NAV_TASK)
        .then((on) => (on ? Location.stopLocationUpdatesAsync(NAV_TASK) : undefined))
        .catch(() => undefined);
    },
  };
}
