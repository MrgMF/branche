// Méthodes de paiement direct classées et mode d'emploi adapté à la borne — fonctions pures (methods.test.ts).
import { isDc } from './estimate';
import type { ChargePoint } from './evse';
import { plugLabel } from './format';
import type { MethodId } from './history';
import { operatorPayUrl, type Operator } from './qr';
import type { Station } from './stations';
import { acceptedBadges, type Wallet } from './accounts';
import { idEntryOf, webStartUrl, type Portals } from './portals';
import { tr } from '../i18n';
import type { IdEntryInfo, MethodCtx } from '../i18n/types';

export function operatorOf(s: Station | null, ops: Operator[]): Operator | undefined {
  return s?.ok ? ops.find((o) => o.key === s.ok) : undefined;
}

export function operatorLabel(s: Station | null, ops: Operator[]): string {
  return operatorOf(s, ops)?.names[0] ?? s?.o?.split('|')[0]?.trim() ?? tr().common.operatorFallback;
}

/** URL de paiement ad hoc connue pour cette borne (gabarit vérifié du registre). */
export function directPayUrl(s: Station, ops: Operator[], pdcId?: string): string | null {
  return operatorPayUrl(operatorOf(s, ops), pdcId ?? s.pdc?.[0]?.[0]);
}

export interface PayOption {
  id: MethodId;
  label: string;
  available: boolean;
  /** Pourquoi cette méthode (ou pourquoi pas). */
  why: string;
  order: 'plug-first' | 'pay-first';
  steps: [string, string, string];
  cta: string;
  url?: string;
  /** Identifiant du point à saisir sur la page de l'opérateur (aucun gabarit {evse} publié). */
  copyId?: string;
  /**
   * Non confirmé pour cette borne (QR code « éventuel », lecteur CB signalé par l'opérateur « sur certains sites ») :
   * jamais « Recommandé », ne suffit pas à dire la borne payable.
   */
  speculative?: true;
}

/** Origine d'un lecteur de carte : base IRVE (borne par borne) ou recherche au niveau de l'opérateur (portails). */
export type ReaderSource = 'irve' | 'operator' | null;

/** Domaines des sources d'un portail (« tesla.com, tesla-mag.com ») : le motif affiché cite la source exacte. */
export function sourceHosts(sources: string[] | null | undefined): string | null {
  const hosts = [...new Set((sources ?? []).map((u) => /^https?:\/\/([^/\s?#]+)/i.exec(u)?.[1]?.toLowerCase().replace(/^www\./, '')).filter((h): h is string => !!h))];
  return hosts.length ? hosts.slice(0, 3).join(', ') : null;
}

export interface PayContext {
  portals?: Portals;
  wallet?: Wallet;
}

/**
 * Méthodes classées, tout dans Branché, sans contrat ni compte par défaut :
 * (1) paiement ponctuel web déclaré (QR dynamique / site web IRVE, page sourcée) ; (1,5) lien connu ;
 * (2) carte bancaire au lecteur ; (2,2) QR code sur la seule foi de `acte` IRVE ; (3) badge accepté ;
 * (4) compte opérateur — seulement si l'opérateur l'impose ET que son site démarre une charge ;
 * (5) QR éventuel non déclaré. Opérateur « appli seule » (source officielle) : ni `acte` ni `paiement_cb` IRVE ne
 * suffisent. Mode d'emploi adapté à la borne.
 */
export function payOptions(s: Station, point: ChargePoint | null, ops: Operator[], ctx: PayContext = {}): PayOption[] {
  const op = operatorLabel(s, ops);
  const portal = s.ok ? ctx.portals?.[s.ok] : undefined;
  const plugs = point?.plugs ?? s.c;
  const kw = point?.kw ?? s.kw;
  const dc = isDc(kw, plugs);
  const plugName = plugs.filter((p) => p !== 'ef').map((p) => plugLabel(p)).join(tr().guidance.or);
  const appOnlyPortal = portal?.appOnly === true;
  // Lecteur de carte : seule la base IRVE le déclare borne par borne. Opérateur « appli seule » (source officielle) :
  // `paiement_cb` IRVE désigne alors la carte enregistrée dans son appli, pas un lecteur sur la borne.
  const reader = !appOnlyPortal && (s.pay.includes('cb') || s.pay.includes('sans_contact'));
  // `cardReader` du portail = recherche au niveau de l'opérateur (« sur certains sites »), jamais confirmé site par site :
  // « possible sur certains sites », jamais recommandé ; non proposé chez un opérateur « appli seule » (Tesla).
  const readerMaybe = !reader && portal?.cardReader === true;
  const readerSource: ReaderSource = reader ? 'irve' : readerMaybe ? 'operator' : null;
  const contactless = s.pay.includes('sans_contact');
  const mc: MethodCtx = { op, short: point?.short ?? null, plugs: plugName, stationCable: dc || !!s.cab, dc, contactless };
  const M = tr().methods;
  const order: PayOption['order'] = dc ? 'plug-first' : 'pay-first';
  // Paiement ponctuel web déclaré (QR dynamique, site web IRVE, ou page sourcée) ; `acte` seul = « paiement à l'acte »
  // sans précision du canal : il ne vaut rien chez un opérateur « appli seule », et passe après un lecteur CB déclaré.
  const webAdHoc = s.pay.some((p) => p === 'qr_dynamique' || p === 'site_web') || !!portal?.adhocWeb;
  const acteOnly = !webAdHoc && !appOnlyPortal && s.pay.includes('acte');
  const declaredAdHoc = webAdHoc || acteOnly;
  // adhocWeb : URL seule (éventuellement avec {evse}) ; un texte descriptif signale seulement un paiement ponctuel
  const adhocRaw = typeof portal?.adhocWeb === 'string' && /^https:\/\/[^\s{}]+(\{evse\}[^\s{}]*)?$/.test(portal.adhocWeb) ? portal.adhocWeb : null;
  const startUrl = webStartUrl(portal, point?.id);
  // adhocWeb descriptif (« https://chge.eu (saisie de l'ID…) », « QR code -> page CB ») : page de démarrage sourcée
  // (webStart, https) en lien de secours sans QR, avec l'identifiant du point à copier (Virta, ENGIE, Qwello, Ionity).
  const startFallback = portal?.adhocWeb && !appOnlyPortal && startUrl && /^https:\/\/[^\s{}]+$/.test(startUrl) ? startUrl : null;
  const portalAdhocUrl = adhocRaw ? (adhocRaw.includes('{evse}') ? (point ? adhocRaw.replace('{evse}', encodeURIComponent(point.id)) : null) : adhocRaw) : startFallback;
  const pointId = point?.id;
  const link = directPayUrl(s, ops, point?.id) ?? portalAdhocUrl;
  const account = s.ok ? ctx.wallet?.accounts.find((a) => a.operatorKey === s.ok) : undefined;
  const myBadges = ctx.wallet?.badges ?? [];
  const accepted = acceptedBadges(myBadges, portal?.roamingBadgesAccepted);
  const badgeMaybe = !accepted.length && !portal?.roamingBadgesAccepted?.length && s.pay.includes('badge') && myBadges.length > 0;

  const idEntry = idEntryOf(portal);
  // Règle produit : sans compte d'abord. Un compte n'est proposé que si l'opérateur l'impose (aucune voie sans compte).
  const noAccountWay = declaredAdHoc || !!link || reader;
  // Compte seulement si son site permet de démarrer une charge (un simple portail de connexion ne sert à rien à la borne)
  const accountUrl = startUrl;
  const ranked: { rank: number; o: PayOption }[] = [];
  if (!noAccountWay && accountUrl) {
    ranked.push({
      rank: account ? 2.5 : 3.5,
      o: {
        id: 'account',
        ...M.account(mc, account?.name ?? null),
        available: true,
        order,
        url: accountUrl,
        copyId: copyIdFor(accountUrl, pointId, idEntry),
      },
    });
  }
  ranked.push({
    rank: webAdHoc ? 1 : acteOnly ? 2.2 : 5,
    o: {
      id: 'scan',
      ...M.scan(mc, declaredAdHoc),
      available: !(appOnlyPortal && !declaredAdHoc),
      order,
      ...(declaredAdHoc ? {} : { speculative: true as const }),
    },
  });
  // Saisie du point sur la page (notes sourcées) : identifiant IRVE à coller (défaut), numéro inscrit sur la borne
  // (Virta), ou choix dans la liste (Ionity). Seul l'identifiant IRVE est copié : ailleurs, le copier tromperait.
  ranked.push({
    rank: 1.5,
    o: {
      id: 'operator-link',
      ...M.link(mc, !!link, idEntry),
      available: !!link,
      order,
      url: link ?? undefined,
      copyId: copyIdFor(link, pointId, idEntry),
    },
  });
  ranked.push({
    rank: reader ? 2 : 4.8,
    o: {
      id: 'reader',
      ...M.reader(mc, { source: readerSource, refs: readerSource === 'operator' ? sourceHosts(portal?.sources) : null }),
      available: reader || (readerMaybe && !appOnlyPortal),
      order,
      ...(readerMaybe ? { speculative: true as const } : {}),
    },
  });
  const badgeName = accepted[0] ?? myBadges[0] ?? null;
  // Badge mentionné seulement si l'IRVE le déclare pour la borne, ou si l'un de vos badges figure dans la liste sourcée
  if (badgeMentioned(s) || accepted.length) {
    ranked.push({
      rank: accepted.length ? 3 : 4.5,
      o: {
        id: 'badge',
        ...M.badge(mc, { accepted, maybe: badgeMaybe, name: badgeName }),
        available: accepted.length > 0 || badgeMaybe,
        order,
      },
    });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return [...ranked.filter((r) => r.o.available), ...ranked.filter((r) => !r.o.available)].map((r) => r.o);
}

/**
 * Identifiant IRVE à copier pour la page ouverte : seulement si l'opérateur fait saisir cet identifiant (emi3, ou
 * saisie non documentée) et que l'adresse ne le contient pas déjà. Numéro inscrit sur la borne (Virta) ou choix dans
 * une liste (Ionity) : rien à copier, le copier tromperait.
 */
export function copyIdFor(url: string | null | undefined, pointId: string | null | undefined, idEntry: IdEntryInfo): string | undefined {
  if (!url || !pointId) return undefined;
  if (idEntry.entry !== null && idEntry.entry !== 'emi3') return undefined;
  return url.includes(encodeURIComponent(pointId)) ? undefined : pointId;
}

/**
 * Suivi d'une recharge (recharge.tsx) : même règle que payOptions pour la page déjà ouverte. `copyId` si l'identifiant
 * est à coller ; sinon `entry` rappelle la saisie propre à l'opérateur (numéro inscrit, choix dans la liste).
 */
export function trackedPointEntry(
  method: MethodId | undefined,
  url: string,
  pointId: string | undefined,
  idEntry: IdEntryInfo,
): { copyId?: string; entry?: 'printed' | 'select'; digits?: [number, number] | null } {
  if (!url || !pointId || (method !== 'operator-link' && method !== 'account')) return {};
  const copyId = copyIdFor(url, pointId, idEntry);
  if (copyId) return { copyId };
  return idEntry.entry === 'printed' || idEntry.entry === 'select' ? { entry: idEntry.entry, digits: idEntry.digits } : {};
}

/** Canal de paiement d'une méthode (moyens acceptés, `acceptedOn`) : page de l'opérateur ou lecteur de la borne. */
export function methodChannel(id: MethodId): 'web' | 'reader' | null {
  return id === 'scan' || id === 'operator-link' ? 'web' : id === 'reader' ? 'reader' : null;
}

/**
 * Moyens acceptés affichés seulement pour une méthode disponible ET déclarée pour cette borne (jamais pour un QR
 * « éventuel » ni un lecteur « sur certains sites ») : sinon, « Accepté : … » laisserait croire à une voie certaine.
 */
export function showsAccepted(o: Pick<PayOption, 'id' | 'available' | 'speculative'>): 'web' | 'reader' | null {
  return o.available && !o.speculative ? methodChannel(o.id) : null;
}

/** Canaux confirmés pour la borne (fiche station) : page de paiement, lecteur. */
export function confirmedChannels(options: PayOption[]): { web: boolean; reader: boolean } {
  const ch = options.map(showsAccepted);
  return { web: ch.includes('web'), reader: ch.includes('reader') };
}

/** L'IRVE déclare un badge pour cette borne : seule condition pour en parler (textes, « Mes badges »). */
export const badgeMentioned = (s: Pick<Station, 'pay'>) => s.pay.includes('badge');

/** Aucun moyen de payer depuis Branché ici (seulement l'appli de l'opérateur ou un badge qu'on n'a pas). */
export function appOnly(options: PayOption[]): boolean {
  return !options.some((o) => o.available);
}

/** Payable depuis Branché sur la foi d'une déclaration (pas seulement « si un QR code est collé »). */
export function surelyPayable(options: PayOption[]): boolean {
  return options.some((o) => o.available && !o.speculative);
}

/** Borne payable la plus proche (stations triées par distance) : la première dont une méthode déclarée est disponible. */
export function nearestPayable<T extends { s: Station }>(sorted: T[], ops: Operator[], ctx: PayContext = {}): T | null {
  return sorted.find(({ s }) => surelyPayable(payOptions(s, null, ops, ctx))) ?? null;
}

/** Badges acceptés à afficher : jamais d'appli tierce (« apps : … », « Plugsurfing (appli) »). */
export function badgeNames(list: string[] | null | undefined): string[] {
  return (list ?? []).filter((b) => !/\b(apps?|appli(cation)?s?)\b/i.test(b)).map((b) => b.trim()).filter(Boolean);
}

/** Lecteur de carte obligatoire (AFIR) à partir de 2027 : mention réservée aux points ≥ 50 kW. */
export const reader2027Applies = (kw: number) => kw >= 50;
