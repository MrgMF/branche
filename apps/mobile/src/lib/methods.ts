// Méthodes de paiement direct classées et mode d'emploi adapté à la borne — fonctions pures (methods.test.ts).
import { isDc } from './estimate';
import type { ChargePoint } from './evse';
import { plugLabel } from './format';
import type { MethodId } from './history';
import { operatorPayUrl, type Operator } from './qr';
import type { Station } from './stations';
import { acceptedBadges, type Wallet } from './accounts';
import { webStartUrl, type Portals } from './portals';
import { tr } from '../i18n';
import type { MethodCtx } from '../i18n/types';

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
  /** QR code « éventuel », non déclaré par l'opérateur : ne suffit pas à dire la borne payable. */
  speculative?: true;
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
  // Opérateur « appli seule » (source officielle) : `paiement_cb` IRVE désigne alors la carte enregistrée dans son appli,
  // pas un lecteur sur la borne. Un lecteur confirmé par le portail (cardReader) reste proposé.
  const reader = portal?.cardReader === true || (!appOnlyPortal && (s.pay.includes('cb') || s.pay.includes('sans_contact')));
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
  const portalAdhocUrl = adhocRaw ? (adhocRaw.includes('{evse}') ? (point ? adhocRaw.replace('{evse}', encodeURIComponent(point.id)) : null) : adhocRaw) : null;
  const pointId = point?.id;
  const link = directPayUrl(s, ops, point?.id) ?? portalAdhocUrl;
  const account = s.ok ? ctx.wallet?.accounts.find((a) => a.operatorKey === s.ok) : undefined;
  const startUrl = webStartUrl(portal, point?.id);
  const myBadges = ctx.wallet?.badges ?? [];
  const accepted = acceptedBadges(myBadges, portal?.roamingBadgesAccepted);
  const badgeMaybe = !accepted.length && !portal?.roamingBadgesAccepted?.length && s.pay.includes('badge') && myBadges.length > 0;

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
        copyId: accountUrl && !accountUrl.includes(encodeURIComponent(pointId ?? '¤')) ? pointId : undefined,
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
  ranked.push({
    rank: 1.5,
    o: {
      id: 'operator-link',
      ...M.link(mc, !!link),
      available: !!link,
      order,
      url: link ?? undefined,
      copyId: link && !link.includes(encodeURIComponent(pointId ?? '¤')) ? pointId : undefined,
    },
  });
  ranked.push({
    rank: 2,
    o: {
      id: 'reader',
      ...M.reader(mc, reader),
      available: reader,
      order,
    },
  });
  const badgeName = accepted[0] ?? myBadges[0] ?? null;
  ranked.push({
    rank: accepted.length ? 3 : 4.5,
    o: {
      id: 'badge',
      ...M.badge(mc, { accepted, maybe: badgeMaybe, name: badgeName }),
      available: accepted.length > 0 || badgeMaybe,
      order,
    },
  });
  ranked.sort((a, b) => a.rank - b.rank);
  return [...ranked.filter((r) => r.o.available), ...ranked.filter((r) => !r.o.available)].map((r) => r.o);
}

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
