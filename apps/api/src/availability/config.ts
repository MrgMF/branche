/**
 * Configuration de la disponibilité temps réel (lue dans l'environnement, indépendante de `Config`).
 *
 * Source par défaut : « [BETA] Base nationale consolidée IRVE – données dynamiques », publiée par le Point d'accès
 * national transport.data.gouv.fr sur data.gouv.fr (schéma etalab/schema-irve-dynamique, Licence Ouverte 2.0).
 * L'URL `/api/1/datasets/r/<id>` est stable et redirige vers la dernière version du fichier.
 */
export const DEFAULT_IRVE_DYN_URL = 'https://www.data.gouv.fr/api/1/datasets/r/89185b1f-f958-4c5b-9282-399a66ecee97';

/** Rafraîchissement par défaut : 2 min (la source est quasi temps réel, ≈ 9 Mo par téléchargement). */
export const DEFAULT_REFRESH_S = 120;
const MIN_REFRESH_S = 120;
const MAX_REFRESH_S = 600;

type Env = Record<string, string | undefined>;

export interface AvailabilityConfig {
  /** null : fonctionnalité désactivée (`IRVE_DYN_URL=off`). */
  url: string | null;
  refreshMs: number;
  /** Préchargement au démarrage (production uniquement : aucun appel réseau en test ou en local). */
  warmup: boolean;
}

export function loadAvailabilityConfig(env: Env = process.env): AvailabilityConfig {
  const raw = env.IRVE_DYN_URL?.trim() || DEFAULT_IRVE_DYN_URL;
  let url: string | null = null;
  if (raw !== 'off') {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error('Variable IRVE_DYN_URL invalide : URL http(s) ou « off » attendue.');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Variable IRVE_DYN_URL invalide : URL http(s) ou « off » attendue.');
    if (u.username || u.password) throw new Error("Variable IRVE_DYN_URL invalide : pas d'identifiants dans l'URL.");
    url = u.toString();
  }
  const rs = env.IRVE_DYN_REFRESH_S?.trim();
  let refreshS = DEFAULT_REFRESH_S;
  if (rs) {
    const n = Number(rs);
    if (!Number.isInteger(n) || n < MIN_REFRESH_S || n > MAX_REFRESH_S) {
      throw new Error(`Variable IRVE_DYN_REFRESH_S invalide : entier entre ${MIN_REFRESH_S} et ${MAX_REFRESH_S} attendu.`);
    }
    refreshS = n;
  }
  return { url, refreshMs: refreshS * 1000, warmup: env.NODE_ENV?.trim() === 'production' };
}

/** Pour GET /v1/meta : la disponibilité est servie sauf si `IRVE_DYN_URL=off`. */
export function availabilityEnabled(env: Env = process.env): boolean {
  return env.IRVE_DYN_URL?.trim() !== 'off';
}
