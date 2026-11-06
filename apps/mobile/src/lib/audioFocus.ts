// Focus audio Android des annonces de guidage (module local modules/branche-audio-focus, lié automatiquement au build
// natif, sans éjection) : musique atténuée pendant la voix. Absent (web, iOS, Expo Go) : sans effet.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type AudioFocusModule = { duck(): boolean; release(): boolean };

const native: AudioFocusModule | null = Platform.OS === 'android' ? requireOptionalNativeModule<AudioFocusModule>('BrancheAudioFocus') : null;

/** Demande le focus audio transitoire avec atténuation des autres sons (avant une annonce). */
export function duckOthers(): void {
  try {
    native?.duck();
  } catch {
    /* module indisponible */
  }
}

/** Rend le focus audio (fin de l'annonce) : la musique reprend son volume. */
export function releaseFocus(): void {
  try {
    native?.release();
  } catch {
    /* module indisponible */
  }
}
