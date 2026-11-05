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
}

export interface PayContext {
  portals?: Portals;
  wallet?: Wallet;
}

/**
 * Méthodes classées, tout dans Branché, sans contrat ni compte par défaut :
 * (1) paiement ponctuel sans compte (QR vérifié, lien connu) ; (2) carte bancaire au lecteur ; (3) badge accepté ;
 * (4) compte opérateur — seulement si l'opérateur l'impose (« Ajouter mon compte X une fois », puis réutilisé) ;
 * (5) QR éventuel non déclaré. Mode d'emploi adapté à la borne.
 */
export function payOptions(s: Station, point: ChargePoint | null, ops: Operator[], ctx: PayContext = {}): PayOption[] {
  const op = operatorLabel(s, ops);
  const portal = s.ok ? ctx.portals?.[s.ok] : undefined;
  const plugs = point?.plugs ?? s.c;
  const kw = point?.kw ?? s.kw;
  const dc = isDc(kw, plugs);
  const plugName = plugs.filter((p) => p !== 'ef').map((p) => plugLabel(p)).join(tr().guidance.or);
  const reader = s.pay.includes('cb') || s.pay.includes('sans_contact') || portal?.cardReader === true;
  const contactless = s.pay.includes('sans_contact');
  const mc: MethodCtx = { op, short: point?.short ?? null, plugs: plugName, stationCable: dc || !!s.cab, dc, contactless };
  const M = tr().methods;
  const order: PayOption['order'] = dc ? 'plug-first' : 'pay-first';
  const declaredAdHoc = s.pay.some((p) => p === 'qr_dynamique' || p === 'site_web' || p === 'acte') || !!portal?.adhocWeb;
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
  const accountUrl = startUrl ?? portal?.webPortal ?? null;
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
    rank: declaredAdHoc ? 1 : 5,
    o: {
      id: 'scan',
      ...M.scan(mc, declaredAdHoc),
      available: !(portal?.appOnly && !declaredAdHoc),
      order,
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
