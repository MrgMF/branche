import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { SimulatorCharger } from './chargers/simulator.js';
import type { ChargerAdapter } from './chargers/types.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { AppError } from './lib/errors.js';
import { createReturnUrlValidator } from './lib/returnUrl.js';
import { MockPaymentProvider } from './payments/mock.js';
import { StripePaymentProvider, createStripeClient, type StripeLike } from './payments/stripe.js';
import type { PaymentProvider } from './payments/types.js';
import { metaRoutes } from './routes/meta.js';
import { mockCheckoutRoutes } from './routes/mockCheckout.js';
import { sessionRoutes } from './routes/sessions.js';
import { webhookRoutes } from './routes/webhook.js';
import { navigationRoutes } from './routes/navigation.js';
import { IncidentService, ReportStore } from './incidents/service.js';
import { TomTomRouteProvider, ValhallaRouteProvider, type RouteProvider } from './navigation/route.js';
import { reqSerializer } from './lib/logRedact.js';
import type { FetchLike } from './lib/ttlCache.js';
import { SessionService } from './sessions/service.js';
import { InMemorySessionStore, type SessionStore } from './sessions/store.js';

export interface AppDeps {
  /** Horloge injectable (tests). */
  now?: () => number;
  /** Faux client Stripe (tests) : évite tout appel réseau. */
  stripeClient?: StripeLike;
  payment?: PaymentProvider;
  charger?: ChargerAdapter;
  store?: SessionStore;
  logger?: boolean | { level: string; stream?: { write: (msg: string) => void } };
  /** fetch injectable (tests : fixtures, aucun appel réseau). */
  fetch?: FetchLike;
  router?: RouteProvider;
}

function buildRouter(config: Config, fetchFn: FetchLike): RouteProvider {
  return config.tomtomApiKey
    ? new TomTomRouteProvider(config.tomtomApiKey, fetchFn)
    : new ValhallaRouteProvider(config.valhallaUrl, fetchFn);
}

/** Journaux sans corps, sans IP ni coordonnées précises (voir lib/logRedact.ts). */
function loggerOptions(logger: AppDeps['logger']) {
  if (!logger) return false;
  const base = logger === true ? {} : logger;
  return { ...base, serializers: { req: reqSerializer } };
}

function buildPayment(config: Config, deps: AppDeps, now: () => number): PaymentProvider {
  if (deps.payment) return deps.payment;
  if (config.paymentProvider === 'mock') return new MockPaymentProvider(config.publicUrl);
  if (!config.stripeWebhookSecret || (!config.stripeSecretKey && !deps.stripeClient)) {
    throw new Error('Configuration Stripe incomplète.');
  }
  return new StripePaymentProvider({
    client: deps.stripeClient ?? createStripeClient(config.stripeSecretKey as string),
    webhookSecret: config.stripeWebhookSecret,
    publicUrl: config.publicUrl,
    checkoutTtlMs: config.checkoutTtlMs,
    now,
  });
}

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const now = deps.now ?? Date.now;
  const app: FastifyInstance = Fastify({
    logger: loggerOptions(deps.logger),
    // Nombre de proxys de confiance (Render : 1) → fonction, pour ne pas faire confiance à un X-Forwarded-For forgé.
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (_addr: string, hop: number) => hop < (config.trustProxy as number)
        : config.trustProxy,
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });

  const payment = buildPayment(config, deps, now);
  const charger = deps.charger ?? new SimulatorCharger({ powerKw: config.simPowerKw, speed: config.simSpeed, now });
  const store = deps.store ?? new InMemorySessionStore({ now });
  const sessions = new SessionService({ config, store, payment, charger, now, log: app.log });
  const ctx: AppContext = {
    config,
    payment,
    sessions,
    isAllowedReturnUrl: createReturnUrlValidator(config.allowedReturnPrefixes),
  };

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (err.validation) {
      return reply.code(400).send({ error: { code: 'invalid_body', message: 'Requête invalide : vérifiez les champs envoyés.' } });
    }
    if (status === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Trop de requêtes, réessayez dans une minute.' } });
    }
    if (status >= 500) {
      req.log.error({ err }, 'erreur interne');
      return reply.code(500).send({ error: { code: 'internal_error', message: 'Erreur interne, réessayez plus tard.' } });
    }
    const message =
      status === 413
        ? 'Requête trop volumineuse.'
        : status === 415
          ? 'Type de contenu non pris en charge.'
          : 'Requête invalide.';
    return reply.code(status).send({ error: { code: STATUS_CODES[status] ?? 'bad_request', message } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Ressource introuvable.' } }),
  );

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: 60_000,
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    return payload;
  });

  await app.register(async (scope) => metaRoutes(scope, ctx));
  await app.register(async (scope) => sessionRoutes(scope, ctx));
  // Page de paiement simulée : uniquement en mode démo (sinon on pourrait démarrer sans payer).
  if (payment.name === 'mock') await app.register(async (scope) => mockCheckoutRoutes(scope, ctx));
  await app.register(async (scope) => webhookRoutes(scope, ctx));

  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const reports = new ReportStore(now);
  const incidents = new IncidentService({ url: config.incidentsUrl, fetchFn, now, reports, log: app.log });
  const router = deps.router ?? buildRouter(config, fetchFn);
  await app.register(async (scope) => navigationRoutes(scope, { router, incidents, reports }));

  return app;
}
