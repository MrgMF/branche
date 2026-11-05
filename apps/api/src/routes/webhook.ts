import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../lib/errors.js';

/**
 * Webhook Stripe. Encapsulé dans son propre contexte pour lire le corps brut (Buffer),
 * indispensable à la vérification de signature.
 */
export async function webhookRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));

  app.post('/v1/stripe/webhook', { config: { rateLimit: false } }, async (req, reply) => {
    const { payment, sessions } = ctx;
    if (!payment.parseWebhook) {
      throw new AppError(404, 'not_found', 'Webhook indisponible en mode démo.');
    }
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || signature.length === 0 || !Buffer.isBuffer(req.body)) {
      throw new AppError(400, 'invalid_signature', 'Signature du webhook absente ou invalide.');
    }
    let event;
    try {
      event = payment.parseWebhook(req.body, signature);
    } catch {
      throw new AppError(400, 'invalid_signature', 'Signature du webhook absente ou invalide.');
    }
    await sessions.handleWebhook(event);
    return reply.send({ received: true });
  });
}
