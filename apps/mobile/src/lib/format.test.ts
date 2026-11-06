import { describe, expect, it } from 'vitest';
import { durationShort, NBSP, withUnit } from './format';

describe('durée unique (fin de recharge, reçu) et unités insécables', () => {
  it.each([
    [3_000, `3${NBSP}s`],
    [12 * 60_000 + 30_000, `12${NBSP}min`],
    [65 * 60_000, `1${NBSP}h${NBSP}05`],
    [-5, `0${NBSP}s`],
  ])('durationShort(%d) → %s', (ms, out) => expect(durationShort(ms)).toBe(out));
  it('texte formaté : espaces nombre-unité insécables', () => {
    expect(withUnit('de 20 % à 80 %, 150 kW')).toBe(`de 20${NBSP}% à 80${NBSP}%, 150${NBSP}kW`);
  });
});
