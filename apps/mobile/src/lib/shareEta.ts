// Partage de l'heure d'arrivée : feuille de partage native, navigator.share sur le web, sinon copie.
import { Platform, Share } from 'react-native';

export type ShareResult = 'shared' | 'copied' | 'failed';

/** Texte partagé : destination et heure, jamais la position actuelle. */
export const etaMessage = (destName: string, clock: string, minutes: number) =>
  `J’arrive à ${destName} vers ${clock} (dans ${minutes} min environ). Envoyé depuis Branché.`;

export async function shareEta(text: string): Promise<ShareResult> {
  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message: text });
      return 'shared';
    } catch {
      return 'failed';
    }
  }
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: { title?: string; text: string }) => Promise<void> }) : null;
  if (nav?.share) {
    try {
      await nav.share({ title: 'Mon heure d’arrivée', text });
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'failed';
    }
  }
  try {
    await nav?.clipboard?.writeText(text);
    return nav?.clipboard ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}
