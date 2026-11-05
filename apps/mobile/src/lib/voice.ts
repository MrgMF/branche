// Voix de guidage : coupable (préférence conservée sur l'appareil), journal des annonces (tests E2E, accessibilité).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { localeTag } from '../i18n';

const KEY = 'branche.nav.voice.v1';
let muted = false;
let loaded: Promise<boolean> | null = null;
const listeners = new Set<(m: boolean) => void>();

export interface Spoken {
  t: number;
  text: string;
  muted: boolean;
  lang: string;
}
/** Dernières annonces (dites ou non, si la voix est coupée). */
export const voiceLog: Spoken[] = [];
if (Platform.OS === 'web' && typeof window !== 'undefined') (window as unknown as { __brancheVoice: Spoken[] }).__brancheVoice = voiceLog;

export function loadVoicePref(): Promise<boolean> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((v) => {
        muted = v === 'off';
        return muted;
      })
      .catch(() => muted);
  }
  return loaded;
}

export const isMuted = () => muted;

export function setMuted(m: boolean): void {
  muted = m;
  loaded = Promise.resolve(m);
  if (m) {
    try {
      Speech.stop();
    } catch {
      /* indisponible */
    }
  }
  AsyncStorage.setItem(KEY, m ? 'off' : 'on').catch(() => undefined);
  listeners.forEach((l) => l(m));
}

export function onMutedChange(l: (m: boolean) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function speak(text: string): void {
  voiceLog.push({ t: Date.now(), text, muted, lang: localeTag() });
  if (voiceLog.length > 50) voiceLog.shift();
  if (muted) return;
  try {
    Speech.stop();
    // Voix de la langue de l'app (région de l'appareil si elle correspond : fr-FR, en-US, de-DE…)
    Speech.speak(text, { language: localeTag(), rate: 1.0 });
  } catch {
    /* synthèse vocale indisponible */
  }
}

export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch {
    /* indisponible */
  }
}
