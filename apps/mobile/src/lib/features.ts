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
