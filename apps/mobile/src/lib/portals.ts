// Portails des opérateurs (data/operator-portals.json, publié avec les tuiles par le pipeline) :
// site officiel, page de démarrage web, paiement ponctuel, badges acceptés. Absent → {} (dégradation propre).
import { DATA_URL } from './config';
import type { IdEntryInfo } from '../i18n/types';

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
  sources?: string[] | null;
}
export type Portals = Record<string, Portal>;

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
