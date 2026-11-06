// Repli CLIENT du site statique (aucune API Branché) : itinéraire via le serveur Valhalla public de FOSSGIS
// (valhalla1.openstreetmap.de), SANS trafic. Serveur communautaire à usage léger et non commercial
// (docs/legal/note-v1.1.md : ≈ 1 requête/s par utilisateur au plus, pas pour la production) :
//  - une requête à la fois, au moins 2 s entre deux requêtes, 20 requêtes par tranche de 10 min au plus ;
//  - aucune requête « de confort » (pas de recherche de trajet plus rapide ni de limitations de vitesse) ;
//  - attribution « © contributeurs OpenStreetMap, Valhalla (FOSSGIS) » affichée à l'écran.
// POST en text/plain (requête simple : pas de pré-vol CORS), coordonnées hors de l'URL.
import { parseValhallaResponse, valhallaRequestBody, type VhOption } from './valhallaParse';

export const FOSSGIS_URL = 'https://valhalla1.openstreetmap.de/route';
export const FOSSGIS_ATTRIBUTION = '© contributeurs OpenStreetMap, Valhalla (FOSSGIS)';
const MIN_GAP_MS = 2000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 20;

export class QuotaError extends Error {
  constructor() {
    super('quota');
    this.name = 'QuotaError';
  }
}

/** Limiteur (pur, testé) : espacement minimal et plafond par fenêtre glissante. */
export class Throttle {
  private stamps: number[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly gapMs = MIN_GAP_MS,
    private readonly windowMs = WINDOW_MS,
    private readonly max = MAX_PER_WINDOW,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Exécute `fn` en respectant les limites ; QuotaError si le plafond est atteint. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const go = async () => {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
      if (this.stamps.length >= this.max) throw new QuotaError();
      const last = this.stamps[this.stamps.length - 1];
      if (last !== undefined && t - last < this.gapMs) await this.sleep(this.gapMs - (t - last));
      this.stamps.push(this.now());
      return fn();
    };
    const p = this.chain.then(go, go);
    this.chain = p.catch(() => undefined);
    return p;
  }
}

const throttle = new Throttle();

export async function routeFossgis(
  req: { from: { lat: number; lon: number }; to: { lat: number; lon: number }; via: { lat: number; lon: number }[]; options: { avoidTolls: boolean; avoidMotorways: boolean } },
  fetchFn: typeof fetch = fetch,
  url = FOSSGIS_URL,
): Promise<VhOption[]> {
  return throttle.run(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetchFn(url, { method: 'POST', body: JSON.stringify(valhallaRequestBody(req)), signal: ctrl.signal });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseValhallaResponse(body);
    } finally {
      clearTimeout(timer);
    }
  });
}
