// Fonctions disponibles côté serveur (GET /v1/meta) — absentes si l'API est injoignable.
import { API_URL } from './config';

export interface Features {
  vehicleIdentify: boolean;
  checkins: boolean;
}
let p: Promise<Features> | null = null;

export function getFeatures(): Promise<Features> {
  const none = { vehicleIdentify: false, checkins: false };
  if (!API_URL) return Promise.resolve(none);
  if (!p) {
    p = fetch(`${API_URL}/v1/meta`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { features?: Partial<Features> }) => ({ ...none, ...(j.features ?? {}) }))
      .catch(() => {
        p = null;
        return none;
      });
  }
  return p;
}

export type Routing = { provider: 'tomtom' | 'valhalla'; fallback: boolean; client?: boolean } | null;

/**
 * Fournisseur d'itinéraire réellement utilisé (attributions) : celui annoncé par l'API (GET /v1/meta),
 * ou Valhalla public calculé par l'app quand il n'y a pas d'API (site statique).
 */
export async function getRouting(): Promise<Routing> {
  if (!API_URL) return { provider: 'valhalla', fallback: false, client: true };
  try {
    const r = await fetch(`${API_URL}/v1/meta`);
    if (!r.ok) return null;
    const j = (await r.json()) as { routing?: Routing };
    return j.routing ?? null;
  } catch {
    return null;
  }
}
