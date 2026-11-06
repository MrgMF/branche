import { afterEach, describe, expect, it } from 'vitest';
import { setLang, setUnits } from '../i18n';
import { km, kw, minutes, NBSP, pct, withUnit } from './format';

const plain = (s: string) => s.includes(' ');

describe('withUnit : espace insécable entre nombre et unité (carte, fiche, bandeau)', () => {
  afterEach(() => {
    setLang('fr');
    setUnits('km');
  });

  it('nombre + unité explicite', () => {
    expect(withUnit(12, 'kW')).toBe(`12${NBSP}kW`);
  });

  it('texte composé : seules les unités sont collées, idempotent', () => {
    expect(withUnit('350 m · 2 min · 22 kW · 80 % · 12,50 €')).toBe(`350${NBSP}m · 2${NBSP}min · 22${NBSP}kW · 80${NBSP}% · 12,50${NBSP}€`);
    expect(withUnit('2 mines et 3 maisons')).toBe('2 mines et 3 maisons');
    expect(withUnit(withUnit('3 km'))).toBe(`3${NBSP}km`);
  });

  it('formatteurs de distance, durée, puissance, pourcentage', () => {
    setLang('fr');
    for (const s of [km(0.35), km(2.4), minutes(2), kw(22), kw(150), pct(80)]) expect(plain(s), s).toBe(false);
    expect(km(0.35)).toBe(`350${NBSP}m`);
    setUnits('mi');
    expect(plain(km(5))).toBe(false);
    setLang('en');
    expect(plain(kw(7.4))).toBe(false);
  });
});
