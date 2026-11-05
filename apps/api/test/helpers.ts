import Stripe from 'stripe';
import { buildApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { StripeLike } from '../src/payments/stripe.js';

export const RETURN_URL = 'branche://session';
export const WEBHOOK_SECRET = 'whsec_test_secret';

export class Clock {
  constructor(public t = Date.UTC(2026, 10, 5, 12, 0, 0)) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export async function makeApp(env: Record<string, string> = {}, deps: AppDeps = {}) {
  const config = loadConfig({ PUBLIC_URL: 'http://api.test', ...env });
  const clock = new Clock();
  const app = await buildApp(config, { now: clock.now, ...deps });
  await app.ready();
  return { app, clock, config };
}

export async function createSession(app: Awaited<ReturnType<typeof makeApp>>['app'], body: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: { stationId: 'FRS01E0001', stationName: 'Parking Mairie', pdcId: 'FRS01E0001-1', returnUrl: RETURN_URL, ...body },
  });
}

/** Faux client Stripe : aucune requête réseau, enregistre les appels. */
export function fakeStripe() {
  const real = new Stripe('sk_test_fake', { maxNetworkRetries: 0 });
  const calls: { method: string; args: unknown[] }[] = [];
  const checkoutStatus = new Map<string, { status: 'open' | 'complete' | 'expired'; pi: string | null }>();
  let n = 0;
  const client: StripeLike = {
    checkout: {
      sessions: {
        async create(params, options) {
          calls.push({ method: 'checkout.create', args: [params, options] });
          n += 1;
          const id = `cs_test_${n}`;
          checkoutStatus.set(id, { status: 'open', pi: null });
          return { id, url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open' } as Stripe.Checkout.Session;
        },
        async retrieve(id) {
          calls.push({ method: 'checkout.retrieve', args: [id] });
          const st = checkoutStatus.get(id) ?? { status: 'open', pi: null };
          return { id, status: st.status, payment_intent: st.pi } as Stripe.Checkout.Session;
        },
        async expire(id, params, options) {
          calls.push({ method: 'checkout.expire', args: [id, params, options] });
          checkoutStatus.set(id, { status: 'expired', pi: null });
          return { id, status: 'expired' } as Stripe.Checkout.Session;
        },
      },
    },
    paymentIntents: {
      async capture(id, params, options) {
        calls.push({ method: 'pi.capture', args: [id, params, options] });
        return { id, status: 'succeeded' } as Stripe.PaymentIntent;
      },
      async cancel(id, params, options) {
        calls.push({ method: 'pi.cancel', args: [id, params, options] });
        return { id, status: 'canceled' } as Stripe.PaymentIntent;
      },
    },
    webhooks: {
      constructEvent: (payload, header, secret) => real.webhooks.constructEvent(payload, header, secret),
    },
  };
  const sign = (payload: string, secret = WEBHOOK_SECRET) => real.webhooks.generateTestHeaderString({ payload, secret });
  return { client, calls, checkoutStatus, sign };
}

export const STRIPE_ENV = {
  ALLOWED_RETURN_PREFIXES: 'branche://,https://monorg.github.io/branche/',
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
