import { Readable } from 'node:stream';
import { parse } from 'csv-parse';

/**
 * Parseur en flux du schéma etalab/schema-irve-dynamique (v2.3.x) :
 * id_pdc_itinerance, etat_pdc, occupation_pdc, horodatage, etat_prise_type_2, etat_prise_type_combo_ccs,
 * etat_prise_type_chademo, etat_prise_type_ef. Les colonnes sont repérées par leur nom (le fichier consolidé
 * peut en ajouter d'autres, dans un autre ordre).
 */

export type AvailabilityStatus = 'libre' | 'occupe' | 'hors_service' | 'inconnu';

/** Même motif que le schéma (après normalisation). */
export const PDC_ID_RE = /^[A-Z]{2}[A-Z0-9]{4,33}$/;

export const ETAT_PDC = ['en_service', 'hors_service', 'inconnu'] as const;
export const OCCUPATION_PDC = ['libre', 'occupe', 'reserve', 'inconnu'] as const;

/** Normalisation : espaces de bord retirés, majuscules, sans `*` (« FR*ABC*E1 » → « FRABCE1 »). null si non conforme. */
export function normalizePdcId(raw: string): string | null {
  const id = raw.trim().toUpperCase().replace(/\*/g, '');
  return PDC_ID_RE.test(id) ? id : null;
}

/**
 * etat_pdc × occupation_pdc → statut affiché.
 * - hors_service → « hors_service » ;
 * - occupé ou réservé → « occupe » (non disponible pour l'usager, quel que soit l'état) ;
 * - en_service + libre → « libre » ;
 * - tout le reste (état inconnu, valeur hors schéma) → « inconnu » (on n'annonce jamais « libre » sans certitude).
 */
export function toStatus(etat: string, occupation: string): AvailabilityStatus {
  const e = etat.trim().toLowerCase();
  const o = occupation.trim().toLowerCase();
  if (e === 'hors_service') return 'hors_service';
  if (o === 'occupe' || o === 'reserve') return 'occupe';
  if (e === 'en_service' && o === 'libre') return 'libre';
  return 'inconnu';
}

const TS_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)(Z|[+-]\d{2}:?\d{2})$/i;

/** Horodatage ISO 8601 avec fuseau obligatoire (sinon ambigu) → ms epoch, ou null. */
export function parseHorodatage(raw: string): number | null {
  const m = TS_RE.exec(raw.trim());
  if (!m) return null;
  let tz = m[3]!.toUpperCase();
  if (tz !== 'Z' && tz.length === 5) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}${tz}`);
  return Number.isNaN(t) ? null : t;
}

export interface PdcState {
  status: AvailabilityStatus;
  /** horodatage de la source (ms epoch). */
  at: number;
}

export interface ParseResult {
  index: Map<string, PdcState>;
  rows: number;
  /** Lignes ignorées (identifiant ou horodatage invalide). */
  rejected: number;
  /** horodatage le plus récent du fichier (ms), null si vide. */
  latest: number | null;
}

export interface ParseLimits {
  maxBytes: number;
  maxRows: number;
}

export const DEFAULT_LIMITS: ParseLimits = { maxBytes: 150 * 1024 * 1024, maxRows: 2_000_000 };

const REQUIRED = ['id_pdc_itinerance', 'etat_pdc', 'occupation_pdc', 'horodatage'] as const;

async function* limitBytes(src: AsyncIterable<Uint8Array | string>, max: number): AsyncGenerator<Uint8Array | string> {
  let n = 0;
  for await (const chunk of src) {
    n += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
    if (n > max) throw new Error('flux IRVE dynamique trop volumineux');
    yield chunk;
  }
}

/**
 * Parse en flux (mémoire ∝ nombre de points de charge, pas taille du fichier). Doublons (fichier consolidé non
 * dédoublonné) : la ligne au horodatage le plus récent l'emporte.
 */
export async function parseIrveDynamic(
  source: AsyncIterable<Uint8Array | string> | string,
  limits: ParseLimits = DEFAULT_LIMITS,
): Promise<ParseResult> {
  const input: AsyncIterable<Uint8Array | string> =
    typeof source === 'string' ? (async function* () { yield source; })() : source;
  const src = Readable.from(limitBytes(input, limits.maxBytes));
  const parser = parse({ bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true });
  src.on('error', (err) => parser.destroy(err));
  src.pipe(parser);

  const index = new Map<string, PdcState>();
  let cols: Record<(typeof REQUIRED)[number], number> | null = null;
  let rows = 0;
  let rejected = 0;
  let latest: number | null = null;

  for await (const rec of parser as AsyncIterable<string[]>) {
    if (!cols) {
      const header = rec.map((h) => h.trim().toLowerCase());
      const pos = REQUIRED.map((c) => header.indexOf(c));
      if (pos.some((p) => p < 0)) {
        src.destroy();
        throw new Error('en-têtes IRVE dynamique absents');
      }
      cols = { id_pdc_itinerance: pos[0]!, etat_pdc: pos[1]!, occupation_pdc: pos[2]!, horodatage: pos[3]! };
      continue;
    }
    rows += 1;
    if (rows > limits.maxRows) {
      src.destroy();
      throw new Error('flux IRVE dynamique : trop de lignes');
    }
    const id = normalizePdcId(rec[cols.id_pdc_itinerance] ?? '');
    const at = parseHorodatage(rec[cols.horodatage] ?? '');
    if (!id || at === null) {
      rejected += 1;
      continue;
    }
    const prev = index.get(id);
    if (prev && prev.at >= at) continue;
    index.set(id, { status: toStatus(rec[cols.etat_pdc] ?? '', rec[cols.occupation_pdc] ?? ''), at });
    if (latest === null || at > latest) latest = at;
  }
  if (!cols) throw new Error('flux IRVE dynamique vide');
  return { index, rows, rejected, latest };
}
