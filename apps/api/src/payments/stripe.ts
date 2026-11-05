import Stripe from 'stripe';
import { withQuery } from '../lib/returnUrl.js';
import type { CheckoutCreated, CheckoutInput, CheckoutState, PaymentProvider, WebhookEvent } from './types.js';

/** Sous-ensemble du SDK Stripe utilisé : permet d'injecter un faux client dans les tests. */
export interface StripeLike {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions): Promise<Stripe.Checkout.Session>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
      expire(id: string, params?: Stripe.Checkout.SessionExpireParams, options?: Stripe.RequestOptions): Promise<Stripe.Checkout.Session>;
    };
  };
  paymentIntents: {
    capture(id: string, params?: Stripe.PaymentIntentCaptureParams, options?: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
    cancel(id: string, params?: Stripe.PaymentIntentCancelParams, options?: Stripe.RequestOptions): Promise<Stripe.PaymentIntent>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, header: string | string[] | Buffer, secret: string): Stripe.Event;
  };
}

export function createStripeClient(secretKey: string): StripeLike {
  return new Stripe(secretKey, {
    maxNetworkRetries: 2,
    timeout: 10_000,
    appInfo: { name: 'branche-api', version: '1.0.0' },
  });
}

export interface StripeProviderOptions {
  client: StripeLike;
  webhookSecret: string;
  /** URL publique de l'API : sert de relais quand returnUrl n'est pas en http(s). */
  publicUrl: string;
  /** Durée de validité de la page de paiement (ms, ≥ 30 min chez Stripe). */
  checkoutTtlMs: number;
  now?: () => number;
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly client: StripeLike;
  private readonly now: () => number;

  constructor(private readonly opts: StripeProviderOptions) {
    this.client = opts.client;
    this.now = opts.now ?? Date.now;
  }

  async createCheckout({ sessionId, stationName, amountCents, returnUrl }: CheckoutInput): Promise<CheckoutCreated> {
    // Stripe n'accepte que des URL web : les schémas d'app (branche://, exp://) passent par un relais
    // /checkout-return/:id qui redirige (303) vers la returnUrl validée et stockée côté serveur.
    const relay = `${this.opts.publicUrl}/checkout-return/${encodeURIComponent(sessionId)}`;
    const successUrl = isHttp(returnUrl) ? withQuery(returnUrl, { session: sessionId }) : relay;
    const cancelUrl = isHttp(returnUrl) ? withQuery(returnUrl, { session: sessionId, cancelled: '1' }) : `${relay}?cancelled=1`;
    const ttlMs = Math.max(this.opts.checkoutTtlMs, 30 * 60 * 1000) + 60_000;

    const session = await this.client.checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'fr',
        client_reference_id: sessionId,
        metadata: { sessionId },
        expires_at: Math.floor((this.now() + ttlMs) / 1000),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: amountCents,
              product_data: {
                name: `Pré-autorisation recharge — ${stationName}`.slice(0, 250),
                description: 'Seul le montant réellement consommé est débité à la fin de la recharge.',
              },
            },
          },
        ],
        payment_intent_data: {
          capture_method: 'manual',
          metadata: { sessionId },
          description: `Recharge Branché ${sessionId}`,
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      { idempotencyKey: `checkout_${sessionId}` },
    );
    if (!session.url) throw new Error('Stripe Checkout n’a pas renvoyé d’URL.');
    return { checkoutUrl: session.url, checkoutId: session.id };
  }

  async getCheckout(checkoutId: string): Promise<CheckoutState> {
    const s = await this.client.checkout.sessions.retrieve(checkoutId);
    if (s.status === 'complete') {
      const paymentRef = idOf(s.payment_intent);
      if (paymentRef) return { state: 'complete', paymentRef };
      return { state: 'open' };
    }
    if (s.status === 'expired') return { state: 'expired' };
    return { state: 'open' };
  }

  async cancelCheckout(checkoutId: string, idempotencyKey: string): Promise<void> {
    const s = await this.client.checkout.sessions.retrieve(checkoutId);
    if (s.status === 'open') {
      await this.client.checkout.sessions.expire(checkoutId, {}, { idempotencyKey: `${idempotencyKey}_expire` });
      return;
    }
    const pi = idOf(s.payment_intent);
    if (s.status === 'complete' && pi) await this.release(pi, idempotencyKey);
  }

  async capture(paymentRef: string, amountCents: number, idempotencyKey: string): Promise<void> {
    await this.client.paymentIntents.capture(paymentRef, { amount_to_capture: amountCents }, { idempotencyKey });
  }

  async release(paymentRef: string, idempotencyKey: string): Promise<void> {
    await this.client.paymentIntents.cancel(paymentRef, { cancellation_reason: 'abandoned' }, { idempotencyKey });
  }

  parseWebhook(rawBody: Buffer, signature: string): WebhookEvent {
    const event = this.client.webhooks.constructEvent(rawBody, signature, this.opts.webhookSecret);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      return {
        kind: 'checkout_completed',
        sessionId: s.metadata?.sessionId ?? s.client_reference_id ?? null,
        checkoutId: s.id,
        paymentRef: idOf(s.payment_intent),
      };
    }
    if (event.type === 'checkout.session.expired') {
      const s = event.data.object;
      return { kind: 'checkout_expired', sessionId: s.metadata?.sessionId ?? s.client_reference_id ?? null, checkoutId: s.id };
    }
    return { kind: 'ignored', type: event.type };
  }
}

