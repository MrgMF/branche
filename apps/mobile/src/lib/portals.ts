// Portails des opérateurs (data/operator-portals.json, publié avec les tuiles par le pipeline) :
// site officiel, page de démarrage web, paiement ponctuel, badges acceptés. Absent → {} (dégradation propre).
import { DATA_URL } from './config';
import type { IdEntryInfo } from '../i18n/types';

/**
 * Lien profond vers l'appli officielle de l'opérateur (passerelle « Démarrer avec l'appli », comme un lien Waze) :
 * Branché n'ouvre que des schémas/URL PUBLICS et documentés, n'imite rien, ne transmet aucun identifiant. null = rien
 * de confirmé pour cet opérateur (on retombe sur la fiche de store, ou rien).
 */
export interface AppLaunch {
  /** Schéma personnalisé (ex. « monapp:// »), ouvert via Linking si l'appli est installée. */
  scheme: string | null;
  /** Universal link https : ouvre l'appli si installée, sinon la page web de l'opérateur. */
  universal: string | null;
  /** Paramètre qui cible une borne précise (son EVSE/ID) sur le lien, s'il est documenté. */
  evseParam: string | null;
  /** Fiche App Store (https://apps.apple.com/…), repli si l'appli n'est pas installée. */
  ios: string | null;
  /** Nom de paquet Android → fiche Google Play, repli si l'appli n'est pas installée. */
  android: string | null;
  sources?: string[] | null;
}

export interface Portal {
  name: string;
  /** Site officiel où l'utilisateur se connecte à son compte. */
  webPortal?: string | null;
  /** Démarrage d'une charge depuis le site (gabarit {evse} possible). */
  webStart?: { status?: string; url?: string | null } | null;
  /** Paiement ponctuel sans compte sur le web (true, ou URL). */
  adhocWeb?: boolean | string | null;
  /**
   * Saisie du point sur la page de paiement (notes sourcées) : `emi3` identifiant IRVE copié par Branché, `printed`
   * numéro inscrit sur la borne (Virta : 4–5 chiffres), `select` choix dans une liste (Ionity). Absent → emi3.
   */
  idEntry?: 'emi3' | 'printed' | 'select' | null;
  /** Nombre de chiffres du numéro inscrit ([min, max]), seulement pour `printed` et s'il est publié. */
  idDigits?: number[] | null;
  cardReader?: boolean | null;
  /** N'accepte que son appli (ou un badge). */
  appOnly?: boolean | null;
  roamingBadgesAccepted?: string[] | null;
  /** Hôtes des pages de paiement officielles (URL sourcées) ; recopiés dans operators.json pour le vérificateur de QR. */
  payDomains?: string[] | null;
  /** Montant maximal pré-autorisé (€), seulement quand l'opérateur le publie. */
  preauthMax?: number | null;
  /** Lien profond / fiche de store de l'appli de l'opérateur (réseaux « appli seule »), null si rien de confirmé. */
  appLaunch?: AppLaunch | null;
  sources?: string[] | null;
  /** Moyens de paiement sourcés (docs/research/payment-methods.md) : page ad hoc et lecteur de la borne. */
  payMethods?: PayMethods | null;
}
export type Portals = Record<string, Portal>;

export type AppOS = 'ios' | 'android' | 'web';

/** Fiche de store de l'appli pour cet OS (repli quand l'appli n'est pas installée), sinon null. */
export function appStoreUrl(a: AppLaunch, os: AppOS): string | null {
  if (os === 'android') return a.android ? `https://play.google.com/store/apps/details?id=${a.android}` : null;
  // iOS et web : la fiche App Store est la plus universelle (sur le web, Google Play s'ouvre aussi dans un navigateur).
  return a.ios ?? (os === 'web' && a.android ? `https://play.google.com/store/apps/details?id=${a.android}` : null);
}

/** Lien qui ouvre l'appli (universal link https prioritaire, sinon schéma), avec la borne ciblée si `evseParam` existe. */
export function appOpenUrl(a: AppLaunch, evse?: string | null): string | null {
  const withEvse = (base: string | null): string | null =>
    base && a.evseParam && evse ? `${base}${base.includes('?') ? '&' : '?'}${a.evseParam}=${encodeURIComponent(evse)}` : base;
  return withEvse(a.universal) ?? withEvse(a.scheme);
}

/** Cible « Démarrer avec l'appli » : lien d'ouverture et fiche de store de repli ; aucune des deux → rien à proposer. */
export function appLaunchTargets(a: AppLaunch | null | undefined, os: AppOS, evse?: string | null): { open: string | null; store: string | null } | null {
  if (!a) return null;
  const open = appOpenUrl(a, evse);
  const store = appStoreUrl(a, os);
  return open || store ? { open, store } : null;
}

/** true/false seulement si une source le dit, sinon null ; « probable » : lecteur sans contact confirmé, portefeuilles non cités. */
export type PayValue = boolean | 'probable' | null;
export interface PayMethods {
  /** Page de paiement ponctuel de l'opérateur (ouverte dans le navigateur intégré). */
  adhoc?: { card?: PayValue; applePay?: PayValue; googlePay?: PayValue; paypal?: PayValue; other?: string[] | null } | null;
  /** Lecteur de carte de la borne. */
  reader?: { contactless?: PayValue; nfcWallets?: PayValue } | null;
  sources?: string[] | null;
}

/** Moyen affiché (icône générique dessinée + nom ; marques en texte seulement). */
export type AcceptedId = 'card' | 'contactless' | 'applePay' | 'googlePay' | 'paypal' | 'other';
export interface AcceptedItem {
  id: AcceptedId;
  /** Nom de marque (Apple Pay, Google Pay, PayPal, ou nom cité par la source) ; null : libellé traduit (CB, Sans contact). */
  brand: string | null;
}
export interface Accepted {
  /** Seulement les valeurs `true` sourcées, dans l'ordre d'affichage. */
  items: AcceptedItem[];
  /** Lecteur sans contact confirmé, Apple Pay / Google Pay non cités : « probablement accepté », jamais certain. */
  nfcProbable: boolean;
}
/** Noms de marque : jamais traduits ni dessinés (texte seul, aucun logo). */
export const BRANDS = { applePay: 'Apple Pay', googlePay: 'Google Pay', paypal: 'PayPal' } as const;

const sourced = (pm: PayMethods | null | undefined): pm is PayMethods => !!pm?.sources?.some((u) => typeof u === 'string' && /^https:\/\//.test(u));

/**
 * Moyens acceptés sur un canal (`web` : page de paiement ponctuel ; `reader` : lecteur de la borne), d'après les seules
 * valeurs `true` sourcées. Inconnu, faux, ou sans source https → null (rien affiché).
 */
export function acceptedOn(portal: Portal | undefined, channel: 'web' | 'reader'): Accepted | null {
  const pm = portal?.payMethods;
  if (!sourced(pm)) return null;
  const items: AcceptedItem[] = [];
  let nfcProbable = false;
  if (channel === 'web') {
    const a = pm.adhoc ?? {};
    if (a.card === true) items.push({ id: 'card', brand: null });
    if (a.applePay === true) items.push({ id: 'applePay', brand: BRANDS.applePay });
    if (a.googlePay === true) items.push({ id: 'googlePay', brand: BRANDS.googlePay });
    if (a.paypal === true) items.push({ id: 'paypal', brand: BRANDS.paypal });
    for (const o of Array.isArray(a.other) ? a.other : []) if (typeof o === 'string' && o.trim()) items.push({ id: 'other', brand: o.trim() });
  } else {
    const r = pm.reader ?? {};
    if (r.contactless === true) items.push({ id: 'contactless', brand: null });
    if (r.nfcWallets === true) items.push({ id: 'applePay', brand: BRANDS.applePay }, { id: 'googlePay', brand: BRANDS.googlePay });
    // « probable » n'a de sens qu'avec un lecteur sans contact confirmé
    nfcProbable = r.nfcWallets === 'probable' && r.contactless === true;
  }
  return items.length || nfcProbable ? { items, nfcProbable } : null;
}

/**
 * Portefeuille confirmé sur la page de paiement, à rappeler selon l'appareil : Apple Pay sur iOS, Google Pay sur
 * Android, les deux sur le web (navigateur quelconque). Rien si la source ne le confirme pas.
 */
export function walletOnPage(portal: Portal | undefined, os: string): string[] {
  const web = acceptedOn(portal, 'web');
  if (!web) return [];
  const has = (id: AcceptedId) => web.items.some((i) => i.id === id);
  const out: string[] = [];
  if (has('applePay') && os !== 'android') out.push(BRANDS.applePay);
  if (has('googlePay') && os !== 'ios') out.push(BRANDS.googlePay);
  return out;
}

let p: Promise<Portals> | null = null;
export function loadPortals(): Promise<Portals> {
  if (!p) {
    p = fetch(`${DATA_URL}/operator-portals.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { operators?: Portals }) => j.operators ?? {})
      .catch(() => {
        p = null;
        return {};
      });
  }
  return p;
}

/** Démarrage web utilisable (statut non négatif et URL présente). */
export function webStartUrl(portal: Portal | undefined, evse: string | undefined): string | null {
  const ws = portal?.webStart;
  if (!ws?.url || /non|absent|no|unavailable|indispon/i.test(ws.status ?? '')) return null;
  return ws.url.includes('{evse}') ? (evse ? ws.url.replace('{evse}', encodeURIComponent(evse)) : null) : ws.url;
}

/** Montant maximal pré-autorisé publié par l'opérateur (€), sinon null (texte générique). */
export function preauthMaxOf(portal: Portal | undefined): number | null {
  const v = portal?.preauthMax;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Saisie du point sur la page de l'opérateur (textes de methods.link), valeurs inattendues ignorées. */
export function idEntryOf(portal: Portal | undefined): IdEntryInfo {
  const e = portal?.idEntry;
  const entry = e === 'emi3' || e === 'printed' || e === 'select' ? e : null;
  const d = portal?.idDigits;
  const digits = entry === 'printed' && Array.isArray(d) && d.length === 2 && d.every((n) => Number.isInteger(n) && n > 0) && d[0] <= d[1] ? ([d[0], d[1]] as [number, number]) : null;
  return { entry, digits };
}

/**
 * Réseau payant selon ses sources : le portail est sourcé (`sources`) et documente un paiement (lecteur de carte,
 * paiement ponctuel, page de paiement, pré-autorisation). Sert à ne pas présenter comme « gratuite, à vérifier » une
 * borne déclarée gratuite d'un réseau payant (Electra, Ionity…) : « tarif non publié dans la base nationale ».
 */
export function portalPaid(portal: Portal | undefined): boolean {
  if (!portal || !portal.sources?.some((u) => /^https:\/\//.test(u))) return false;
  return portal.cardReader === true || !!portal.adhocWeb || !!portal.payDomains?.length || preauthMaxOf(portal) != null;
}
