// Voix de guidage : coupable (préférence conservée sur l'appareil), file d'annonces priorisée (speechQueue.ts),
// journal des annonces (tests E2E, accessibilité).
//
// Session audio (expo-speech ~58, vérifié dans node_modules/expo-speech) :
// - iOS : `useApplicationAudioSession: false` → AVSpeechSynthesizer.usesApplicationAudioSession = false : le système
//   crée une session dédiée à la parole qui gère interruptions, mixage et atténuation (ducking) de la musique, puis
//   la rétablit après chaque annonce. Écran verrouillé : UIBackgroundModes « audio » + « location » (app.config.ts),
//   l'app reste active pendant le guidage grâce au suivi de position en arrière-plan (accord « toujours »).
//   Mode silencieux : comportement de la session système à confirmer sur appareil réel ; si la voix y est coupée,
//   il faudra expo-audio (setAudioModeAsync playsInSilentMode + interruptionMode 'duckOthers') avec
//   useApplicationAudioSession: true — non ajouté ici (dépendance native supplémentaire, build de développement).
// - Android : expo-speech ne demande pas de focus audio. Le module local modules/branche-audio-focus (Expo Modules,
//   lié automatiquement au build natif, sans éjection ni permission) demande AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
//   (usage USAGE_ASSISTANCE_NAVIGATION_GUIDANCE) avant chaque annonce et le rend à la fin : la musique est atténuée
//   pendant la voix. Limite restante : expo-speech ne fixe pas les AudioAttributes de sa synthèse, la voix suit donc
//   le volume média (pas le volume « guidage »). Expo Go / web : module absent, sans effet.
// - Web : speechSynthesis du navigateur, aucune maîtrise de la session audio (le guidage exige l'écran allumé).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { localeTag } from '../i18n';
import { duckOthers, releaseFocus } from './audioFocus';
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

/** Options audio de guidage passées à chaque annonce (iOS : session système, atténuation de la musique). */
export const SPEECH_AUDIO: Pick<Speech.SpeechOptions, 'useApplicationAudioSession'> = { useApplicationAudioSession: false };

// Jeton de la dernière annonce passée à la synthèse (même rôle que le jeton interne de SpeechQueue) : une annonce qui se
// termine alors qu'une plus récente a déjà redemandé le focus ne doit pas le rendre (sinon la musique repasse à plein
// volume pendant la consigne suivante). Garde-fou propre : si la synthèse ne signale jamais sa fin, le focus est rendu.
let speakToken = 0;
let guard: ReturnType<typeof setTimeout> | null = null;
const clearGuard = () => {
  if (guard) clearTimeout(guard);
  guard = null;
};
/** Garde-fou de fin (ms) : moteur muet → on rend quand même le focus. Calé sur SpeechQueue (2500 + 90/caractère). */
const guardMs = (text: string) => 2500 + text.length * 90;

const queue = new SpeechQueue({
  speak(text, done) {
    const entry = [...voiceLog].reverse().find((e) => e.text === text && e.spokenAt === undefined);
    if (entry) entry.spokenAt = Date.now();
    // Voix de la langue de l'app (région de l'appareil si elle correspond : fr-FR, en-US, de-DE…)
    // Android : musique atténuée pendant l'annonce (focus audio rendu seulement si l'annonce est encore la courante).
    const token = ++speakToken;
    duckOthers();
    let settled = false;
    const end = () => {
      if (settled) return;
      settled = true;
      // Encore la courante (aucune annonce plus récente n'a redemandé le focus) : nettoyer le garde-fou et, s'il ne
      // reste rien en file, rendre le focus. La suivante éventuelle garde la musique atténuée (pas de va-et-vient).
      if (token === speakToken) {
        clearGuard();
        if (queue.pending.length === 0) releaseFocus();
      }
      done();
    };
    // Garde-fou : si onDone/onStopped/onError n'arrive jamais, rendre le focus et débloquer la file.
    clearGuard();
    guard = setTimeout(end, guardMs(text));
    Speech.speak(text, { ...SPEECH_AUDIO, language: localeTag(), rate: 1.0, onDone: end, onStopped: end, onError: end });
  },
  stop() {
    clearGuard();
    try {
      Speech.stop();
    } catch {
      /* indisponible */
    }
    releaseFocus();
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
