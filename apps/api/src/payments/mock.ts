import type { CheckoutCreated, CheckoutInput, CheckoutState, PaymentProvider } from './types.js';

export interface MockOperation {
  type: 'capture' | 'release';
  paymentRef: string;
  amountCents: number;
}

/**
 * Paiement simulé : aucune requête externe, aucun débit.
 * La page /mock-checkout/:id joue le rôle de Stripe Checkout.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  /** Journal des opérations, indexé par clé d'idempotence (rejouer une clé est sans effet). */
  readonly operations = new Map<string, MockOperation>();

  constructor(private readonly publicUrl: string) {}

  async createCheckout({ sessionId }: CheckoutInput): Promise<CheckoutCreated> {
    return { checkoutUrl: `${this.publicUrl}/mock-checkout/${encodeURIComponent(sessionId)}`, checkoutId: null };
  }

  async getCheckout(): Promise<CheckoutState> {
    return { state: 'open' };
  }

  async cancelCheckout(): Promise<void> {
    /* rien à annuler côté prestataire */
  }

  async capture(paymentRef: string, amountCents: number, idempotencyKey: string): Promise<void> {
    if (!this.operations.has(idempotencyKey)) {
      this.operations.set(idempotencyKey, { type: 'capture', paymentRef, amountCents });
    }
  }

  async release(paymentRef: string, idempotencyKey: string): Promise<void> {
    if (!this.operations.has(idempotencyKey)) {
      this.operations.set(idempotencyKey, { type: 'release', paymentRef, amountCents: 0 });
    }
  }
}
