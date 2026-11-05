import type { PayMethod, Plug } from './stations';

export const euros = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

export const km = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);

/** Temps de trajet indicatif en ville (≈ 25 km/h), arrondi à la minute. */
export const minutes = (d: number) => `${Math.max(1, Math.round((d / 25) * 60))} min`;

export const kw = (v: number) => (v ? `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kW` : 'Puissance inconnue');

export const PLUG_LABEL: Record<Plug, string> = { ccs: 'CCS Combo', t2: 'Type 2', chademo: 'CHAdeMO', ef: 'Prise domestique' };

export const PAY_LABEL: Record<PayMethod, string> = {
  cb: 'Carte bancaire',
  sans_contact: 'Sans contact',
  acte: 'Paiement sans abonnement',
  qr_dynamique: 'QR code',
  site_web: 'Site web',
  liquide: 'Espèces',
  badge: 'Badge ou appli',
};

export const kwh = (wh: number) => `${(wh / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
