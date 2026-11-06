import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combine, SpeechQueue, type Engine } from './speechQueue';

function fakeEngine() {
  const said: string[] = [];
  const stops: number[] = [];
  let done: (() => void) | null = null;
  const engine: Engine = {
    speak: (text, d) => {
      said.push(text);
      done = d;
    },
    stop: () => {
      stops.push(said.length);
      const d = done;
      done = null;
      d?.();
    },
  };
  return { engine, said, stops, end: () => { const d = done; done = null; d?.(); } };
}

describe('file d’annonces vocales', () => {
  let t = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('combine les parties d’une position, manœuvre d’abord, sans doublon', () => {
    expect(combine([
      { text: 'Travaux signalés dans 800 mètres', priority: 'info' },
      { text: 'Zone de danger', priority: 'danger' },
      { text: 'Dans 300 mètres, tournez à droite', priority: 'maneuver' },
      { text: 'Zone de danger', priority: 'danger' },
    ])).toEqual({ text: 'Dans 300 mètres, tournez à droite. Zone de danger. Travaux signalés dans 800 mètres.', priority: 'maneuver', at: 0 });
    expect(combine([{ text: '  ', priority: 'info' }])).toBeNull();
  });

  it('ne coupe jamais une manœuvre : la suivante attend, l’info aussi', () => {
    const f = fakeEngine();
    const q = new SpeechQueue(f.engine, () => t);
    q.announce([{ text: 'Dans 300 mètres, tournez à droite.', priority: 'maneuver' }]);
    q.announce([{ text: 'Zone de danger.', priority: 'danger' }]);
    q.announce([{ text: 'Tournez à droite.', priority: 'maneuver' }]);
    expect(f.stops).toEqual([]);
    expect(f.said).toEqual(['Dans 300 mètres, tournez à droite.']);
    expect(q.pending).toEqual(['Tournez à droite.', 'Zone de danger.']);
    f.end();
    expect(f.said[1]).toBe('Tournez à droite.');
    f.end();
    expect(f.said[2]).toBe('Zone de danger.');
  });

  it('une manœuvre interrompt une info en cours ; une info n’interrompt rien', () => {
    const f = fakeEngine();
    const q = new SpeechQueue(f.engine, () => t);
    q.announce([{ text: 'Nouvel itinéraire.', priority: 'info' }]);
    q.announce([{ text: 'Info 2.', priority: 'info' }]);
    expect(f.stops).toEqual([]);
    q.announce([{ text: 'Tournez à gauche.', priority: 'maneuver' }]);
    expect(f.stops.length).toBe(1);
    expect(q.speaking).toBe('Tournez à gauche.');
  });

  it('une seule manœuvre en attente (la plus récente), infos périmées abandonnées', () => {
    const f = fakeEngine();
    const q = new SpeechQueue(f.engine, () => t);
    q.announce([{ text: 'M1.', priority: 'maneuver' }]);
    q.announce([{ text: 'I1.', priority: 'info' }]);
    q.announce([{ text: 'M2.', priority: 'maneuver' }]);
    q.announce([{ text: 'M3.', priority: 'maneuver' }]);
    expect(q.pending).toEqual(['M3.', 'I1.']);
    t = 20_000;
    f.end(); // M3
    f.end(); // I1 périmée : rien
    expect(f.said).toEqual(['M1.', 'M3.']);
  });

  it('garde-fou : si le moteur ne signale pas la fin, la file avance', () => {
    const f = fakeEngine();
    const q = new SpeechQueue({ speak: (x) => f.said.push(x), stop: () => undefined }, () => t, () => 1000);
    q.announce([{ text: 'A.', priority: 'maneuver' }]);
    q.announce([{ text: 'B.', priority: 'maneuver' }]);
    vi.advanceTimersByTime(1001);
    expect(f.said).toEqual(['A.', 'B.']);
    q.clear();
    expect(q.speaking).toBeNull();
  });
});
