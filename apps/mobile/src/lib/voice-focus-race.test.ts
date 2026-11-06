// Course du focus audio (Android) : une annonce qui se termine tard ne doit pas rendre le focus pendant la consigne
// suivante (musique à plein volume), et le garde-fou de fin doit rendre le focus si la synthèse reste muette.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
type Opts = { onDone?: () => void; onStopped?: () => void; onError?: () => void };
const handlers = new Map<string, Opts>();

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    name === 'BrancheAudioFocus'
      ? { duck: () => (calls.push('duck'), true), release: () => (calls.push('release'), true) }
      : null,
}));
vi.mock('expo-speech', () => ({
  speak: (text: string, o: Opts) => {
    calls.push(`speak:${text}`);
    handlers.set(text, o);
  },
  stop: () => calls.push('stop'),
}));

async function freshVoice() {
  const voice = await import('./voice');
  voice.stopSpeaking();
  voice.setMuted(false);
  calls.length = 0;
  handlers.clear();
  return voice;
}

describe('focus audio : course entre annonces', () => {
  afterEach(() => vi.useRealTimers());

  it('annonce interrompue qui se termine tard : ne rend pas le focus pendant la suivante', async () => {
    const voice = await freshVoice();
    // Une info démarre (musique atténuée), puis un danger plus prioritaire l'interrompt.
    voice.speak('Information.', 'info');
    voice.speak('Attention danger.', 'danger');
    // L'interruption a arrêté l'info et relancé une atténuation pour le danger.
    expect(calls).toEqual(['duck', 'speak:Information.', 'stop', 'release', 'duck', 'speak:Attention danger.']);
    // onStopped de l'info arrive en retard : il ne doit PAS rendre le focus (le danger est en cours).
    const mark = calls.length;
    handlers.get('Information.')?.onStopped?.();
    expect(calls.slice(mark)).not.toContain('release');
    // Fin normale du danger (plus rien en file) : focus rendu.
    handlers.get('Attention danger.')?.onDone?.();
    expect(calls.slice(mark)).toEqual(['release']);
  });

  it('chaînage : pas de va-et-vient du focus entre deux manœuvres successives', async () => {
    const voice = await freshVoice();
    voice.speak('Première manœuvre.', 'maneuver');
    // Deuxième manœuvre mise en file (une manœuvre en cours n'est jamais coupée).
    voice.speak('Seconde manœuvre.', 'maneuver');
    expect(calls).toEqual(['duck', 'speak:Première manœuvre.']);
    // Fin de la première : la file n'est pas vide → aucun « release », la seconde garde l'atténuation
    // (le « duck » répété ne fait que re-confirmer un focus déjà détenu, sans va-et-vient de volume).
    handlers.get('Première manœuvre.')?.onDone?.();
    expect(calls).toEqual(['duck', 'speak:Première manœuvre.', 'duck', 'speak:Seconde manœuvre.']);
    expect(calls).not.toContain('release');
    // Fin de la seconde, file vide : focus rendu une seule fois.
    handlers.get('Seconde manœuvre.')?.onDone?.();
    expect(calls.filter((c) => c === 'release')).toEqual(['release']);
  });

  it('garde-fou de fin : synthèse muette → focus rendu après le délai', async () => {
    vi.useFakeTimers();
    const voice = await freshVoice();
    voice.speak('Tournez à droite.', 'maneuver');
    expect(calls).toEqual(['duck', 'speak:Tournez à droite.']);
    // Aucun onDone/onStopped : le garde-fou doit finir par rendre le focus.
    vi.advanceTimersByTime(60_000);
    expect(calls).toContain('release');
  });
});
