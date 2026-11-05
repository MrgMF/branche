// Formats d'affichage : délégués à src/i18n (langue et unités courantes).
import { tr } from '../i18n';
import { euros as eurosFmt, kmText, kwhText, kwText } from '../i18n/format';
import type { PayMethod, Plug } from './stations';

export const euros = (cents: number) => eurosFmt(cents);

export const km = (d: number) => kmText(d);

/** Temps de trajet indicatif en ville (≈ 25 km/h), arrondi à la minute. */
export const minutes = (d: number) => `${Math.max(1, Math.round((d / 25) * 60))} min`;

export const kw = (v: number) => kwText(v);

export const plugLabel = (p: Plug) => tr().plugs[p];
export const payLabel = (p: PayMethod) => tr().pay[p];

export const kwh = (wh: number) => kwhText(Math.round(wh / 100) / 10);
