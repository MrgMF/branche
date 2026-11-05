// Traductions légères, sans dépendance : dictionnaires typés (fr = source ; une clé manquante ailleurs = erreur TS),
// langue courante + unités dans un petit magasin observable. Les composants lisent `useT()` (re-rendu au changement),
// le code hors React lit `tr()`. Aucune importation de react-native ici (testé sous Node).
import { useSyncExternalStore } from 'react';
import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr, type Dict } from './fr';
import { it } from './it';
import { nl } from './nl';
import { pt } from './pt';

export type { Dict } from './fr';
export type Lang = 'fr' | 'en' | 'es' | 'de' | 'it' | 'pt' | 'nl';
export type Units = 'km' | 'mi';

export const DICTS: Record<Lang, Dict> = { fr, en, es, de, it, pt, nl };
/** Noms des langues dans leur propre langue (sélecteur). */
export const LANG_NAMES: Record<Lang, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
};
export const LANGS = Object.keys(DICTS) as Lang[];
const DEFAULT_TAG: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' };

interface State {
  lang: Lang;
  /** Étiquette BCP 47 pour Intl et la synthèse vocale (région de l'appareil si même langue). */
  tag: string;
  units: Units;
  t: Dict;
}

let state: State = { lang: 'fr', tag: 'fr-FR', units: 'km', t: fr };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isLang = (x: unknown): x is Lang => typeof x === 'string' && x in DICTS;

/** Langue parmi les étiquettes de l'appareil, par ordre de préférence ; anglais si aucune n'est disponible. */
export function pickLang(tags: readonly string[]): { lang: Lang; tag: string } {
  for (const raw of tags) {
    const code = raw.toLowerCase().split(/[-_]/)[0];
    if (isLang(code)) return { lang: code, tag: raw.replace('_', '-') };
  }
  return { lang: 'en', tag: DEFAULT_TAG.en };
}

export function setLang(lang: Lang, deviceTag?: string): void {
  const tag = deviceTag && deviceTag.toLowerCase().startsWith(lang) ? deviceTag : DEFAULT_TAG[lang];
  if (state.lang === lang && state.tag === tag) return;
  state = { ...state, lang, tag, t: DICTS[lang] };
  emit();
}

export function setUnits(units: Units): void {
  if (state.units === units) return;
  state = { ...state, units };
  emit();
}

export const tr = (): Dict => state.t;
export const lang = (): Lang => state.lang;
export const localeTag = (): string => state.tag;
export const units = (): Units => state.units;

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => state;

/** Dictionnaire courant ; le composant est re-rendu au changement de langue ou d'unités. */
export function useT(): Dict {
  return useSyncExternalStore(subscribe, snapshot, snapshot).t;
}
/** Langue, étiquette et unités courantes (dépendances de mémos). */
export function useLocale(): Omit<State, 't'> {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { lang: s.lang, tag: s.tag, units: s.units };
}
