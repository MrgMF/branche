export interface CheckoutInput {
  sessionId: string;
  stationName: string;
  amountCents: number;
  /** URL de retour validée (préfixe autorisé). */
  returnUrl: string;
}

export interface CheckoutCreated {
  checkoutUrl: string;
  /** Identifiant côté prestataire (Stripe : cs_…). null en mode mock. */
  checkoutId: string | null;
}

export type CheckoutState =
  | { state: 'open' }
  | { state: 'complete'; paymentRef: string }
  | { state: 'expired' };

export type WebhookEvent =
  | { kind: 'checkout_completed'; sessionId: string | null; checkoutId: string; paymentRef: string | null }
  | { kind: 'checkout_expired'; sessionId: string | null; checkoutId: string }
  | { kind: 'ignored'; type: string };

/**
 * Prestataire de paiement. Aucune donnée de carte ne transite par l'API :
 * seule une référence opaque d'autorisation (PaymentIntent) est conservée.
 */
export interface PaymentProvider {
  readonly name: 'mock' | 'stripe';
  createCheckout(input: CheckoutInput): Promise<CheckoutCreated>;
  /** État d'une page de paiement (rattrapage si le webhook n'arrive pas). */
  getCheckout(checkoutId: string): Promise<CheckoutState>;
  /** Annule une page de paiement pas encore réglée, ou libère l'autorisation si elle l'a été. */
  cancelCheckout(checkoutId: string, idempotencyKey: string): Promise<void>;
  /** Capture (débit) d'un montant ≤ pré-autorisation. Idempotent via la clé. */
  capture(paymentRef: string, amountCents: number, idempotencyKey: string): Promise<void>;
  /** Libère la pré-autorisation sans rien débiter. Idempotent via la clé. */
  release(paymentRef: string, idempotencyKey: string): Promise<void>;
  /** Vérifie la signature et normalise un webhook (Stripe uniquement). Lève une erreur si invalide. */
  parseWebhook?(rawBody: Buffer, signature: string): WebhookEvent;
}
