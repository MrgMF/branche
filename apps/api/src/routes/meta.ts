import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export async function metaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { config } = ctx;
  const demo = config.paymentProvider === 'mock';

  app.get('/health', { config: { rateLimit: false } }, async () => ({
    ok: true,
    mode: demo ? 'demo' : 'live',
    payment: config.paymentProvider,
    charger: config.chargerAdapter,
  }));

  app.get('/v1/config', async () => ({
    priceCentsPerKwh: config.priceCentsPerKwh,
    feeCents: config.feeCents,
    preauthCents: config.preauthCents,
    currency: 'eur',
    demo,
  }));
}
