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
  };
}
