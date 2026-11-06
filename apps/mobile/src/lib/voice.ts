// Voix de guidage : coupable (préférence conservée sur l'appareil), file d'annonces priorisée (speechQueue.ts),
// journal des annonces (tests E2E, accessibilité).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { localeTag } from '../i18n';
import { combine, SpeechQueue, type Part, type Priority } from './speechQueue';

export type { Part, Priority } from './speechQueue';

const KEY = 'branche.nav.voice.v1';
let muted = false;
let loaded: Promise<boolean> | null = null;
const listeners = new Set<(m: boolean) => void>();

export interface Spoken {
  t: number;
  text: string;
  muted: boolean;
  lang: string;
  priority?: Priority;
  /** Moment où la synthèse a réellement commencé (file d'attente). */
  spokenAt?: number;
}
/** Dernières annonces (dites ou non, si la voix est coupée). */
export const voiceLog: Spoken[] = [];
if (Platform.OS === 'web' && typeof window !== 'undefined') (window as unknown as { __brancheVoice: Spoken[] }).__brancheVoice = voiceLog;

const queue = new SpeechQueue({
  speak(text, done) {
    const entry = [...voiceLog].reverse().find((e) => e.text === text && e.spokenAt === undefined);
    if (entry) entry.spokenAt = Date.now();
    // Voix de la langue de l'app (région de l'appareil si elle correspond : fr-FR, en-US, de-DE…)
    Speech.speak(text, { language: localeTag(), rate: 1.0, onDone: done, onStopped: done, onError: done });
  },
  stop() {
    try {
      Speech.stop();
    } catch {
      /* indisponible */
    }
  },
});

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
  if (m) queue.clear();
  AsyncStorage.setItem(KEY, m ? 'off' : 'on').catch(() => undefined);
  listeners.forEach((l) => l(m));
}

export function onMutedChange(l: (m: boolean) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Annonce d'une position : parties combinées en une phrase, mise en file selon la priorité. */
export function announce(parts: Part[]): void {
  const list = parts.filter((p) => p.text.trim());
  const item = combine(list);
  if (!item) return;
  const { text, priority } = item;
  voiceLog.push({ t: Date.now(), text, muted, lang: localeTag(), priority });
  if (voiceLog.length > 50) voiceLog.shift();
  if (muted) return;
  try {
    queue.announce(list);
  } catch {
    /* synthèse vocale indisponible */
  }
}

/** Annonce simple (information). */
export const speak = (text: string, priority: Priority = 'info') => announce([{ text, priority }]);

export function stopSpeaking(): void {
  queue.clear();
}
