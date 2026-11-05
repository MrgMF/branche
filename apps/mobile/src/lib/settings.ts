// Réglages de l'app, persistés sur l'appareil (AsyncStorage) : langue, unités, options d'itinéraire par défaut.
// La voix de guidage garde sa propre clé (voice.ts) ; ce module la pilote.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { deviceLang } from '../i18n/device';
import { isLang, setLang, setUnits, type Lang, type Units } from '../i18n';
import { clearWallet } from './accounts';
import { clearHistory } from './history';
import { clearPrepared } from './prepared';
import { clearRecents } from './recents';
import { store } from './store';
import { saveVehicle } from './vehicle';

export interface Settings {
  /** 'auto' = langue de l'appareil. */
  lang: 'auto' | Lang;
  units: Units;
  avoidTolls: boolean;
  avoidMotorways: boolean;
}

const KEY = 'branche.settings.v1';
const DEFAULTS: Settings = { lang: 'auto', units: 'km', avoidTolls: false, avoidMotorways: false };
let current: Settings = DEFAULTS;
const listeners = new Set<() => void>();

function apply(s: Settings) {
  const dev = deviceLang();
  if (s.lang === 'auto') setLang(dev.lang, dev.tag);
  else setLang(s.lang, dev.tag);
  setUnits(s.units);
}

/** Lecture au démarrage (avant le premier écran). */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    current = {
      lang: p.lang === 'auto' || isLang(p.lang) ? p.lang : 'auto',
      units: p.units === 'mi' ? 'mi' : 'km',
      avoidTolls: p.avoidTolls === true,
      avoidMotorways: p.avoidMotorways === true,
    };
  } catch {
    current = DEFAULTS;
  }
  apply(current);
  return current;
}

export const getSettings = () => current;

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  apply(current);
  AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => undefined);
  listeners.forEach((l) => l());
  return current;
}

const sub = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useSettings(): Settings {
  return useSyncExternalStore(sub, getSettings, getSettings);
}

/** Efface les données locales : historique, véhicule, comptes et badges, destinations récentes, recharge préparée ou suivie. */
export async function resetLocalData(): Promise<void> {
  await Promise.all([clearHistory(), saveVehicle(null), clearWallet(), clearRecents(), clearPrepared()]);
  store.setDirect(null);
  store.setPlan(null);
  await AsyncStorage.removeItem('branche.vehicle.skipped.v1').catch(() => undefined);
}
