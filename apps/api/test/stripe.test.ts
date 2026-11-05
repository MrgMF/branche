import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createSession, fakeStripe, makeApp, STRIPE_ENV } from './helpers.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function completedEvent(checkoutId: string, sessionId: string, pi = 'pi_test_1') {
  return JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: checkoutId, object: 'checkout.session', metadata: { sessionId }, payment_intent: pi, status: 'complete' } },
  });
}

describe('mode Stripe (faux client)', () => {
  it('crée une Checkout Session en pré-autorisation manuelle', async () => {
    const stripe = fakeStripe();
    ({ app } = await makeApp(STRIPE_ENV, { stripeClient: stripe.client }));
    expect((await app.inject('/health')).json()).toMatchObject({ mode: 'live', payment: 'stripe' });
    const res = await createSession(app, { returnUrl: 'https://monorg.github.io/branche/session' });
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s.demo).toBe(false);
    expect(s.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    const [params, options] = stripe.calls[0]!.args as [any, any];
    expect(params.mode).toBe('payment');
    expect(params.payment_intent_data.capture_method).toBe('manual');
    expect(params.line_items[0].price_data.unit_amount).toBe(5000);
    expect(params.line_items[0].price_data.currency).toBe('eur');
    expect(params.line_items[0].price_data.product_data.name).toBe('Pré-autorisation recharge — Parking Mairie');
    expect(params.metadata.sessionId).toBe(s.id);
    expect(params.success_url).toBe(`https://monorg.github.io/branche/session?session=${s.id}`);
    expect(params.cancel_url).toBe(`https://monorg.github.io/branche/session?session=${s.id}&cancelled=1`);
    expect(options.idempotencyKey).toBe(`checkout_${s.id}`);
  });

  it('returnUrl en schéma d’app → relais /checkout-return qui redirige', async () => {
    const stripe = fakeStripe();
    ({ app } = await makeApp(STRIPE_ENV, { stripeClient: stripe.client }));
    const s = (await createSession(app)).json();
    const [params] = stripe.calls[0]!.args as [any];
    expect(params.success_url).toBe(`http://api.test/checkout-return/${s.id}`);
    const r = await app.inject(`/checkout-return/${s.id}?cancelled=1`);
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe(`branche://session?session=${s.id}&cancelled=1`);
  });

  it('webhook signature invalide → 400', async () => {
    const stripe = fakeStripe();
    ({ app } = await makeApp(STRIPE_ENV, { stripeClient: stripe.client }));
    const s = (await createSession(app)).json();
    const payload = completedEvent('cs_test_1', s.id);
    for (const signature of [stripe.sign(payload, 'whsec_autre'), 't=1,v1=deadbeef']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/stripe/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_signature');
    }
    const none = await app.inject({ method: 'POST', url: '/v1/stripe/webhook', headers: { 'content-type': 'application/json' }, payload });
    expect(none.statusCode).toBe(400);
    expect((await app.inject(`/v1/sessions/${s.id}`)).json().status).toBe('awaiting_payment');
  });

  it('webhook valide → charging, puis stop → capture amount_to_capture idempotente', async () => {
    const stripe = fakeStripe();
    let clock;
    ({ app, clock } = await makeApp(STRIPE_ENV, { stripeClient: stripe.client }));
    const s = (await createSession(app)).json();
    const payload = completedEvent('cs_test_1', s.id);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': stripe.sign(payload) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect((await app.inject(`/v1/sessions/${s.id}`)).json().status).toBe('charging');
    clock.advance(60_000);
    const done = (await app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/stop` })).json();
    expect(done).toMatchObject({ status: 'completed', totalCents: 674 });
    const captures = stripe.calls.filter((c) => c.method === 'pi.capture');
    expect(captures).toHaveLength(1);
    expect(captures[0]!.args).toEqual(['pi_test_1', { amount_to_capture: 674 }, { idempotencyKey: `capture_${s.id}` }]);
  });

  it('rattrapage sans webhook : GET vérifie la Checkout Session', async () => {
    const stripe = fakeStripe();
    ({ app } = await makeApp(STRIPE_ENV, { stripeClient: stripe.client }));
    const s = (await createSession(app)).json();
    stripe.checkoutStatus.set('cs_test_1', { status: 'complete', pi: 'pi_test_9' });
    const cur = (await app.inject(`/v1/sessions/${s.id}`)).json();
    expect(cur.status).toBe('charging');
    expect(stripe.calls.some((c) => c.method === 'checkout.retrieve')).toBe(true);
  });

  it('arrêt immédiat à 0 kWh : totalCents = frais, et annulation sans paiement → expire', async () => {
    const stripe = fakeStripe();
    ({ app } = await makeApp({ ...STRIPE_ENV, FEE_CENTS: '0' }, { stripeClient: stripe.client }));
    const s = (await createSession(app)).json();
    stripe.checkoutStatus.set('cs_test_1', { status: 'complete', pi: 'pi_zero' });
    await app.inject(`/v1/sessions/${s.id}`);
    const done = (await app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/stop` })).json();
    expect(done.totalCents).toBe(0);
    expect(stripe.calls.find((c) => c.method === 'pi.cancel')?.args[0]).toBe('pi_zero');
    expect(stripe.calls.some((c) => c.method === 'pi.capture')).toBe(false);

    const b = (await createSession(app)).json();
    const cancelled = await app.inject({ method: 'POST', url: `/v1/sessions/${b.id}/cancel` });
    expect(cancelled.json().status).toBe('cancelled');
    expect(stripe.calls.some((c) => c.method === 'checkout.expire' && c.args[0] === 'cs_test_2')).toBe(true);
  });

  it('la page de paiement simulée n’existe pas en mode Stripe', async () => {
    const stripe = fakeStripe();
    ({ app } = await makeApp(STRIPE_ENV, { stripeClient: stripe.client }));
    const s = (await createSession(app)).json();
    expect((await app.inject(`/mock-checkout/${s.id}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/mock-checkout/${s.id}/authorize` })).statusCode).toBe(404);
    expect((await app.inject(`/v1/sessions/${s.id}`)).json().status).toBe('awaiting_payment');
  });

  it('refuse une clé Stripe live et une config incomplète', () => {
    expect(() => loadConfig({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow();
    expect(() => loadConfig({ PAYMENT_PROVIDER: 'stripe' })).toThrow();
    expect(() => loadConfig({ PAYMENT_PROVIDER: 'paypal' })).toThrow();
  });
});
