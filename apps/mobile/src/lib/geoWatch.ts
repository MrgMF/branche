// Suivi de position multiplateforme. Sur le web, navigator.geolocation directement : le watchPositionAsync
// d'expo-location (SDK 58) remplace son identifiant d'abonnement par celui du navigateur, ce qui perd les
// rappels dès que deux suivis coexistent et n'appelle jamais clearWatch.
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface GeoSample {
  lat: number;
  lon: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  t: number;
}

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
    (p) =>
      cb({
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy ?? null,
        heading: p.coords.heading ?? null,
        speed: p.coords.speed ?? null,
        t: p.timestamp || Date.now(),
      }),
  );
  return sub;
}
