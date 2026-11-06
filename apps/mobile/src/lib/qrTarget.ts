// À quel point de charge mène un QR code, par rapport au choix de l'utilisateur — fonctions pures (qrTarget.test.ts).
// Règle : jamais de bascule silencieuse. Un QR code d'un autre point ou d'une autre borne demande une confirmation.
import { normId, pointById, type ChargePoint } from './evse';
import { normalizeEvse } from './qr';
import type { Station } from './stations';

export type QrTarget =
  /** Pas d'identifiant de point dans le QR code (ou identifiant inconnu). */
  | { kind: 'none' }
  /** Le point choisi (ou un point de la borne choisie, aucun point n'étant encore fixé). */
  | { kind: 'same'; point: ChargePoint | null }
  /** Un autre point de la même borne : confirmation. */
  | { kind: 'point'; point: ChargePoint; chosen: ChargePoint }
  /** Une autre borne : confirmation. */
  | { kind: 'station'; station: Station; pdcId: string | null }
  /** Aucune borne choisie (scan depuis l'accueil) : la borne du QR code est retenue. */
  | { kind: 'select'; station: Station; pdcId: string | null };

/** Identifiant de point (eMI3) contenu dans un lien ou un texte (…?evse=FR*ABC*E123), normalisé. */
export function evseInText(raw: string): string | null {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    /* texte brut */
  }
  const m = text.toUpperCase().match(/[A-Z]{2}\*?[A-Z0-9]{3}\*?E[A-Z0-9*]{1,40}/);
  return m ? normalizeEvse(m[0]) : null;
}

/**
 * @param at borne choisie (null : scan depuis l'accueil sans borne)
 * @param chosenPdc point choisi dans le parcours (null : pas encore de point)
 * @param evse identifiant lu dans le QR code
 * @param found résultat de findStation(evse) (null : inconnu ou hors ligne)
 */
export function qrTarget(
  at: Station | null,
  chosenPdc: string | null | undefined,
  evse: string | null,
  found: { station: Station; pdcId: string | null } | null,
): QrTarget {
  if (!evse) return { kind: 'none' };
  if (at) {
    const pt = pointById(at, evse);
    if (pt || normId(at.id) === normId(evse)) {
      const chosen = chosenPdc ? pointById(at, chosenPdc) : undefined;
      if (pt && chosen && normId(chosen.id) !== normId(pt.id)) return { kind: 'point', point: pt, chosen };
      return { kind: 'same', point: pt ?? chosen ?? null };
    }
    if (found && found.station.id !== at.id) return { kind: 'station', station: found.station, pdcId: found.pdcId };
    if (found) return { kind: 'same', point: pointById(at, found.pdcId) ?? null };
    return { kind: 'none' };
  }
  return found ? { kind: 'select', station: found.station, pdcId: found.pdcId } : { kind: 'none' };
}
