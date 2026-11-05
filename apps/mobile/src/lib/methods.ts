// Méthodes de paiement direct classées et mode d'emploi adapté à la borne — fonctions pures (methods.test.ts).
import { isDc } from './estimate';
import type { ChargePoint } from './evse';
import { PLUG_LABEL } from './format';
import type { MethodId } from './history';
import { operatorPayUrl, type Operator } from './qr';
import type { Station } from './stations';

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
}

/**
 * Méthodes classées : (a) carte au lecteur si l'IRVE l'indique ; (b) page de l'opérateur via QR vérifié ;
 * (c) lien opérateur connu ; (d) Carte Branché (bientôt, désactivée). Mode d'emploi adapté à la borne.
 */
export function payOptions(s: Station, point: ChargePoint | null, ops: Operator[]): PayOption[] {
  const op = operatorLabel(s, ops);
  const plugs = point?.plugs ?? s.c;
  const kw = point?.kw ?? s.kw;
  const dc = isDc(kw, plugs);
  const pt = point ? `le point …${point.short}` : 'le point choisi';
  const nearPt = point ? `du point …${point.short}` : 'du point choisi';
  const plugName = plugs.filter((p) => p !== 'ef').map((p) => PLUG_LABEL[p]).join(' ou ') || 'de la borne';
  const cable = dc || s.cab ? `le câble ${plugName} de la borne` : 'votre câble Type 2';
  const reader = s.pay.includes('cb') || s.pay.includes('sans_contact');
  const contactless = s.pay.includes('sans_contact');
  const declaredAdHoc = s.pay.some((p) => p === 'qr_dynamique' || p === 'site_web' || p === 'acte');
  const link = directPayUrl(s, ops, point?.id);

  const out: PayOption[] = [];
  out.push({
    id: 'reader',
    label: contactless ? 'Carte bancaire sans contact sur la borne' : 'Carte bancaire sur la borne',
    available: reader,
    why: reader
      ? 'Lecteur de carte déclaré par l’opérateur (base nationale IRVE). Ni appli ni compte, et Branché ne voit pas votre carte.'
      : 'Aucun lecteur de carte déclaré pour cette borne.',
    order: dc ? 'plug-first' : 'pay-first',
    steps: dc
      ? [`Branchez ${cable} sur votre voiture.`, `Sur l’écran de la borne, choisissez ${pt} puis « Paiement par carte ».`, `${contactless ? 'Approchez votre carte du lecteur' : 'Insérez votre carte dans le lecteur'} et suivez l’écran : la charge démarre après validation.`]
      : [`${contactless ? 'Approchez votre carte du lecteur (logo sans contact)' : 'Insérez votre carte dans le lecteur'} et choisissez ${pt} si la borne le demande.`, 'Attendez la validation du paiement à l’écran.', `Branchez ${cable} : la charge démarre.`],
    cta: 'J’ai payé par carte',
  });
  out.push({
    id: 'scan',
    label: 'QR code de la borne, vérifié par Branché',
    available: true,
    why: declaredAdHoc
      ? `Paiement sans abonnement déclaré par l’opérateur : Branché vérifie que le QR code mène bien au site de ${op}.`
      : `Si un QR code de paiement est collé sur la borne. Branché vérifie qu’il mène bien au site de ${op}.`,
    order: dc ? 'plug-first' : 'pay-first',
    steps: dc
      ? [`Branchez ${cable} sur votre voiture.`, `Scannez le QR code près ${nearPt} : Branché vérifie l’adresse.`, `Payez sur la page officielle de ${op} (carte, Apple Pay ou Google Pay), puis revenez ici.`]
      : [`Scannez le QR code près ${nearPt} : Branché vérifie l’adresse.`, `Payez sur la page officielle de ${op}, puis revenez ici.`, `Branchez ${cable} : la charge démarre après validation.`],
    cta: 'Scanner le QR code',
  });
  out.push({
    id: 'operator-link',
    label: `Page de paiement ${op}`,
    available: !!link,
    why: link ? 'Adresse officielle de paiement connue pour cet opérateur.' : 'Pas de lien de paiement direct connu pour cet opérateur.',
    order: dc ? 'plug-first' : 'pay-first',
    steps: dc
      ? [`Branchez ${cable} sur votre voiture.`, `Ouvrez la page de paiement de ${op} et vérifiez que ${pt} est indiqué.`, 'Payez, puis revenez dans Branché.']
      : [`Ouvrez la page de paiement de ${op} et vérifiez que ${pt} est indiqué.`, 'Payez, puis revenez dans Branché.', `Branchez ${cable} : la charge démarre.`],
    cta: `Ouvrir la page ${op}`,
    url: link ?? undefined,
  });
  out.push({
    id: 'branche-card',
    label: 'Carte Branché',
    available: false,
    why: 'Bientôt : une carte de paiement virtuelle dans votre Wallet, acceptée sur tous les lecteurs CB. Elle nécessite un partenaire bancaire, pas encore signé.',
    order: 'pay-first',
    steps: ['Ajoutez la Carte Branché à Apple Pay ou Google Pay.', 'Présentez votre téléphone au lecteur de la borne.', 'Branchez : la charge démarre.'],
    cta: 'Bientôt disponible',
  });
  // Disponibles d'abord, dans l'ordre de la spécification
  return [...out.filter((o) => o.available), ...out.filter((o) => !o.available)];
}

