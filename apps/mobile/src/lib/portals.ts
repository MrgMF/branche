// Portails des opérateurs (data/operator-portals.json, publié avec les tuiles par le pipeline) :
// site officiel, page de démarrage web, paiement ponctuel, badges acceptés. Absent → {} (dégradation propre).
import { DATA_URL } from './config';

export interface Portal {
  name: string;
  /** Site officiel où l'utilisateur se connecte à son compte. */
  webPortal?: string | null;
  /** Démarrage d'une charge depuis le site (gabarit {evse} possible). */
  webStart?: { status?: string; url?: string | null } | null;
  /** Paiement ponctuel sans compte sur le web (true, ou URL). */
  adhocWeb?: boolean | string | null;
  cardReader?: boolean | null;
  /** N'accepte que son appli (ou un badge). */
  appOnly?: boolean | null;
  roamingBadgesAccepted?: string[] | null;
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
