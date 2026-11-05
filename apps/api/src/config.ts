export type PaymentProviderName = 'mock' | 'stripe';
export type ChargerAdapterName = 'simulator';

export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  paymentProvider: PaymentProviderName;
  chargerAdapter: ChargerAdapterName;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  priceCentsPerKwh: number;
  feeCents: number;
  preauthCents: number;
  simPowerKw: number;
  simSpeed: number;
  allowedReturnPrefixes: string[];
  rateLimitMax: number;
  trustProxy: boolean | number;
  /** Délai max pour payer avant annulation automatique (ms). */
  checkoutTtlMs: number;
  /** Clé TomTom (serveur uniquement, jamais renvoyée). Absente → Valhalla sans trafic. */
  tomtomApiKey: string | null;
  /**
   * Instance Valhalla (`/route`). Défaut hors production : serveur public FOSSGIS (non commercial).
   * `null` = aucun itinéraire possible (production sans clé TomTom ni VALHALLA_URL explicite) → 503.
   */
  valhallaUrl: string | null;
  production: boolean;
  /** Zones où les signalements sont suspendus (interdiction préfectorale), jusqu'à `until` (ms). */
  reportsDisabled: ReportsDisabledZone[];
  /** Flux DATEX II Bison Futé (événements RRN non concédé). */
  incidentsUrl: string;
  /** Photon (recherche d'adresse sans clé TomTom). null = désactivé (PHOTON_URL=off). */
  photonUrl: string | null;
}

export interface ReportsDisabledZone {
  w: number;
  s: number;
  e: number;
  n: number;
  until: number;
}

/** REPORTS_DISABLED = « w,s,e,n|ISO-fin;w,s,e,n|ISO-fin… » (date ISO 8601 avec fuseau). */
export function parseReportsDisabled(raw: string | undefined): ReportsDisabledZone[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(';')
    .map((z) => z.trim())
    .filter((z) => z.length > 0)
    .map((z) => {
      const err = () => new Error(`Variable REPORTS_DISABLED invalide : « ${z} » (attendu « ouest,sud,est,nord|2026-12-31T23:59:59+01:00 »).`);
      const [box, end, extra] = z.split('|');
      if (!box || !end || extra !== undefined) throw err();
      const nums = box.split(',').map((x) => x.trim());
      if (nums.length !== 4 || nums.some((x) => !/^-?\d{1,3}(?:\.\d+)?$/.test(x))) throw err();
      const [w, s, e, n] = nums.map(Number) as [number, number, number, number];
      if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) throw err();
      // Fuseau obligatoire : une date ambiguë ne doit pas lever l'interdiction trop tôt.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(end.trim())) throw err();
      const until = Date.parse(end.trim());
      if (Number.isNaN(until)) throw err();
      return { w, s, e, n, until };
    });
}

export const DEFAULT_VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
export const DEFAULT_INCIDENTS_URL = 'https://www.data.gouv.fr/api/1/datasets/r/d16c8cb6-0123-44e7-b8b1-f99fc6a59497';
/** Recherche d'adresse sans clé (données OSM). Usage raisonnable toléré par komoot ; « off » désactive. */
export const DEFAULT_PHOTON_URL = 'https://photon.komoot.io/api/';

function httpUrl(env: Env, name: string, def: string): string {
  const raw = env[name]?.trim() || def;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Variable ${name} invalide : URL http(s) attendue.`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`Variable ${name} invalide : URL http(s) attendue.`);
  if (u.username || u.password) throw new Error(`Variable ${name} invalide : pas d'identifiants dans l'URL.`);
  return u.toString();
}

/**
 * Défaut sûr : app installée (branche://) et développement local.
 * En production, fixer ALLOWED_RETURN_PREFIXES (ex. « branche://,https://<owner>.github.io/branche/app/ »).
 * « exp://LAN » autorise Expo Go sur une IP de réseau privé uniquement (tests sur téléphone).
 */
export const DEFAULT_RETURN_PREFIXES = 'branche://,http://localhost,http://127.0.0.1,exp://LAN';

type Env = Record<string, string | undefined>;

function int(env: Env, name: string, def: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`Variable ${name} invalide : entier ≥ ${min} attendu, reçu « ${raw} ».`);
  }
  return n;
}

function num(env: Env, name: string, def: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Variable ${name} invalide : nombre > 0 attendu, reçu « ${raw} ».`);
  }
  return n;
}

function trustProxy(raw: string | undefined): boolean | number {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  throw new Error(`Variable TRUST_PROXY invalide : true, false ou un entier attendu.`);
}

export function loadConfig(env: Env = process.env): Config {
  const port = int(env, 'PORT', 8787, 1);
  const paymentProvider = (env.PAYMENT_PROVIDER ?? 'mock').trim() || 'mock';
  if (paymentProvider !== 'mock' && paymentProvider !== 'stripe') {
    throw new Error('PAYMENT_PROVIDER doit valoir « mock » ou « stripe ».');
  }
  const chargerAdapter = (env.CHARGER_ADAPTER ?? 'simulator').trim() || 'simulator';
  if (chargerAdapter !== 'simulator') {
    throw new Error('CHARGER_ADAPTER : seul « simulator » est disponible en V1.');
  }
  const stripeSecretKey = env.STRIPE_SECRET_KEY?.trim() || null;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  if (paymentProvider === 'stripe') {
    if (!stripeSecretKey || !stripeWebhookSecret) {
      throw new Error('PAYMENT_PROVIDER=stripe requiert STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET.');
    }
    // Garde-fou V1 : jamais d'argent réel pour une borne simulée.
    if (stripeSecretKey.startsWith('sk_live_') || stripeSecretKey.startsWith('rk_live_')) {
      throw new Error('Clé Stripe live refusée : la borne est simulée en V1 (utilisez une clé sk_test_).');
    }
  }

  const publicUrl = (env.PUBLIC_URL?.trim() || env.RENDER_EXTERNAL_URL?.trim() || `http://localhost:${port}`).replace(
    /\/+$/,
    '',
  );

  const feeCents = int(env, 'FEE_CENTS', 49);
  const preauthCents = int(env, 'PREAUTH_CENTS', 5000, 50);
  if (feeCents >= preauthCents) throw new Error('FEE_CENTS doit être inférieur à PREAUTH_CENTS.');

  const allowedReturnPrefixes = (env.ALLOWED_RETURN_PREFIXES?.trim() || DEFAULT_RETURN_PREFIXES)
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const production = env.NODE_ENV?.trim() === 'production';
  const tomtomApiKey = env.TOMTOM_API_KEY?.trim() || null;

  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    publicUrl,
    paymentProvider,
    chargerAdapter,
    stripeSecretKey,
    stripeWebhookSecret,
    priceCentsPerKwh: int(env, 'PRICE_CENTS_PER_KWH', 45, 1),
    feeCents,
    preauthCents,
    simPowerKw: num(env, 'SIM_POWER_KW', 50),
    simSpeed: num(env, 'SIM_SPEED', 20),
    allowedReturnPrefixes,
    rateLimitMax: int(env, 'RATE_LIMIT_MAX', 60, 1),
    trustProxy: trustProxy(env.TRUST_PROXY?.trim()),
    checkoutTtlMs: 30 * 60 * 1000,
    tomtomApiKey,
    // En production, jamais le serveur public FOSSGIS (non commercial) : il faut une URL explicite.
    valhallaUrl: env.VALHALLA_URL?.trim() || !production ? httpUrl(env, 'VALHALLA_URL', DEFAULT_VALHALLA_URL) : null,
    production,
    reportsDisabled: parseReportsDisabled(env.REPORTS_DISABLED),
    incidentsUrl: httpUrl(env, 'INCIDENTS_URL', DEFAULT_INCIDENTS_URL),
    photonUrl: env.PHOTON_URL?.trim() === 'off' ? null : httpUrl(env, 'PHOTON_URL', DEFAULT_PHOTON_URL),
  };
}
