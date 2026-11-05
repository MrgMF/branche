// Méthodes de paiement direct classées et mode d'emploi adapté à la borne — fonctions pures (methods.test.ts).
import { isDc } from './estimate';
import type { ChargePoint } from './evse';
import { PLUG_LABEL } from './format';
import type { MethodId } from './history';
import { operatorPayUrl, type Operator } from './qr';
import type { Station } from './stations';
import { acceptedBadges, type Wallet } from './accounts';
import { webStartUrl, type Portals } from './portals';

export function operatorOf(s: Station | null, ops: Operator[]): Operator | undefined {
  return s?.ok ? ops.find((o) => o.key === s.ok) : undefined;
}

export function operatorLabel(s: Station | null, ops: Operator[]): string {
  return operatorOf(s, ops)?.names[0] ?? s?.o?.split('|')[0]?.trim() ?? 'l’opérateur';
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
  const pt = point ? `le point …\u2060${point.short}` : 'le point choisi';
  const nearPt = point ? `du point …\u2060${point.short}` : 'du point choisi';
  const plugName = plugs.filter((p) => p !== 'ef').map((p) => PLUG_LABEL[p]).join(' ou ') || 'de la borne';
  const cable = dc || s.cab ? `le câble ${plugName} de la borne` : 'votre câble Type 2';
  const order: PayOption['order'] = dc ? 'plug-first' : 'pay-first';
  const reader = s.pay.includes('cb') || s.pay.includes('sans_contact') || portal?.cardReader === true;
  const contactless = s.pay.includes('sans_contact');
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
        label: account ? `Démarrer avec mon compte ${account.name}` : `Ajouter mon compte ${op} une fois`,
        available: true,
        why: account
          ? `${op} impose un compte. Le vôtre est déjà connecté dans Branché : la page officielle s’ouvre directement.`
          : `${op} impose un compte. Créez-le ou connectez-vous une seule fois sur son site officiel, dans Branché ; ensuite Branché le réutilise automatiquement.`,
        order,
        steps: account
          ? dc
            ? [`Branchez ${cable} sur votre voiture.`, `Sur la page officielle de ${op}, vérifiez ${pt} et lancez la charge.`, 'Revenez dans Branché : le suivi démarre.']
            : [`Sur la page officielle de ${op}, vérifiez ${pt} et lancez la charge.`, `Branchez ${cable}.`, 'Revenez dans Branché : le suivi démarre.']
          : [`Sur le site officiel de ${op}, ouvert dans Branché, créez votre compte ou connectez-vous.`, `Lancez la charge sur ${pt}${dc ? ' après avoir branché le câble' : ', puis branchez'}.`, 'Revenez dans Branché : le suivi démarre, et le compte sera réutilisé la prochaine fois.'],
        cta: account ? `Démarrer avec mon compte ${account.name}` : `Ajouter mon compte ${op}`,
        url: accountUrl,
        copyId: accountUrl && !accountUrl.includes(encodeURIComponent(pointId ?? '¤')) ? pointId : undefined,
      },
    });
  }
  ranked.push({
    rank: declaredAdHoc ? 1 : 5,
    o: {
      id: 'scan',
      label: 'QR code de la borne, vérifié par Branché',
      available: !(portal?.appOnly && !declaredAdHoc),
      why: declaredAdHoc
        ? `Paiement ponctuel sans compte déclaré par l’opérateur : Branché vérifie que le QR code mène bien au site de ${op}.`
        : `Si un QR code de paiement est collé sur la borne. Branché vérifie qu’il mène bien au site de ${op}.`,
      order,
      steps: dc
        ? [`Branchez ${cable} sur votre voiture.`, `Scannez le QR code près ${nearPt} : Branché vérifie l’adresse.`, `Payez sur la page officielle de ${op} (carte, Apple Pay ou Google Pay), puis revenez ici.`]
        : [`Scannez le QR code près ${nearPt} : Branché vérifie l’adresse.`, `Payez sur la page officielle de ${op}, puis revenez ici.`, `Branchez ${cable} : la charge démarre après validation.`],
      cta: 'Scanner le QR code',
    },
  });
  ranked.push({
    rank: 1.5,
    o: {
      id: 'operator-link',
      label: `Page de paiement ${op}`,
      available: !!link,
      why: link ? 'Adresse officielle de paiement sans compte connue pour cet opérateur.' : 'Pas de lien de paiement direct connu pour cet opérateur.',
      order,
      steps: dc
        ? [`Branchez ${cable} sur votre voiture.`, `Sur la page de paiement de ${op}, collez l’identifiant de ${pt} (copié par Branché).`, 'Payez, puis revenez dans Branché.']
        : [`Sur la page de paiement de ${op}, collez l’identifiant de ${pt} (copié par Branché).`, 'Payez, puis revenez dans Branché.', `Branchez ${cable} : la charge démarre.`],
      cta: `Ouvrir la page ${op}`,
      url: link ?? undefined,
      copyId: link && !link.includes(encodeURIComponent(pointId ?? '¤')) ? pointId : undefined,
    },
  });
  ranked.push({
    rank: 2,
    o: {
      id: 'reader',
      label: contactless ? 'Carte bancaire sans contact sur la borne' : 'Carte bancaire sur la borne',
      available: reader,
      why: reader
        ? 'Lecteur de carte déclaré par l’opérateur (base nationale IRVE). Ni appli ni compte, et Branché ne voit pas votre carte.'
        : 'Aucun lecteur de carte déclaré pour cette borne.',
      order,
      steps: dc
        ? [`Branchez ${cable} sur votre voiture.`, `Sur l’écran de la borne, choisissez ${pt} puis « Paiement par carte ».`, `${contactless ? 'Approchez votre carte du lecteur' : 'Insérez votre carte dans le lecteur'} et suivez l’écran : la charge démarre après validation.`]
        : [`${contactless ? 'Approchez votre carte du lecteur (logo sans contact)' : 'Insérez votre carte dans le lecteur'} et choisissez ${pt} si la borne le demande.`, 'Attendez la validation du paiement à l’écran.', `Branchez ${cable} : la charge démarre.`],
      cta: 'J’ai payé par carte',
    },
  });
  const badgeName = accepted[0] ?? myBadges[0] ?? 'de recharge';
  ranked.push({
    rank: accepted.length ? 3 : 4.5,
    o: {
      id: 'badge',
      label: `Mon badge ${badgeName}`,
      available: accepted.length > 0 || badgeMaybe,
      why: accepted.length
        ? `${accepted.join(', ')} accepté${accepted.length > 1 ? 's' : ''} sur les bornes ${op} (selon l’opérateur).`
        : badgeMaybe
          ? 'Badges d’itinérance acceptés selon la base IRVE, sans précision des réseaux : votre badge peut fonctionner.'
          : 'Aucun de vos badges n’est indiqué comme accepté ici.',
      order,
      steps: dc
        ? [`Branchez ${cable} sur votre voiture.`, `Passez votre badge sur le lecteur et choisissez ${pt} si la borne le demande.`, 'La charge démarre : Branché la suit ici.']
        : [`Passez votre badge sur le lecteur et choisissez ${pt} si la borne le demande.`, `Branchez ${cable}.`, 'La charge démarre : Branché la suit ici.'],
      cta: 'J’ai passé mon badge',
    },
  });
  ranked.sort((a, b) => a.rank - b.rank);
  return [...ranked.filter((r) => r.o.available), ...ranked.filter((r) => !r.o.available)].map((r) => r.o);
}

/** Aucun moyen de payer depuis Branché ici (seulement l'appli de l'opérateur ou un badge qu'on n'a pas). */
export function appOnly(options: PayOption[]): boolean {
  return !options.some((o) => o.available);
}
