// Android : focus audio demandé avant chaque annonce (musique atténuée) et rendu à la fin (module local branche-audio-focus).
import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    name === 'BrancheAudioFocus'
      ? {
          duck: () => (calls.push('duck'), true),
          release: () => (calls.push('release'), true),
        }
      : null,
}));
type Opts = { onDone?: () => void };
let last: Opts | null = null;
vi.mock('expo-speech', () => ({
  speak: (text: string, o: Opts) => {
    calls.push(`speak:${text}`);
    last = o;
  },
  stop: () => calls.push('stop'),
}));

describe('voix Android : atténuation de la musique pendant les annonces', () => {
  it('focus demandé avant la synthèse, rendu à la fin de l’annonce', async () => {
    const voice = await import('./voice');
    voice.setMuted(false);
    voice.speak('Prenez la bretelle.', 'maneuver');
    expect(calls).toEqual(['duck', 'speak:Prenez la bretelle.']);
    last?.onDone?.();
    expect(calls.slice(2)).toEqual(['release']);
  });

  it('arrêt de la voix : focus rendu', async () => {
    const voice = await import('./voice');
    calls.length = 0;
    voice.speak('Tournez à droite.', 'maneuver');
    voice.stopSpeaking();
    expect(calls).toContain('release');
  });
});
