// Destinations récentes : stockées uniquement sur l'appareil (aucun envoi), 8 au plus, effaçables.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Place } from './navigation';

const KEY = 'branche.nav.recents.v1';
const MAX = 8;
let cache: Place[] | null = null;

export async function loadRecents(): Promise<Place[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Place[]) : [];
    cache = Array.isArray(list) ? list.filter((p) => p && typeof p.lat === 'number' && typeof p.lon === 'number' && typeof p.label === 'string').slice(0, MAX) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export async function addRecent(p: Place): Promise<Place[]> {
  const list = await loadRecents();
  const item: Place = { label: p.label, sublabel: p.sublabel, lat: p.lat, lon: p.lon, kind: p.kind };
  cache = [item, ...list.filter((x) => !(x.label === p.label && x.sublabel === p.sublabel))].slice(0, MAX);
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => undefined);
  return cache;
}

export async function clearRecents(): Promise<void> {
  cache = [];
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}
