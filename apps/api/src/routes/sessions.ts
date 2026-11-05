import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { withQuery } from '../lib/returnUrl.js';
import { toDto } from '../sessions/store.js';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const createBody = {
  type: 'object',
  required: ['stationId', 'stationName', 'returnUrl'],
  additionalProperties: false,
  properties: {
    stationId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9*_.:\\-]+$' },
    stationName: { type: 'string', minLength: 1, maxLength: 160 },
    pdcId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9*_.:\\-]+$' }, { type: 'null' }] },
    returnUrl: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;

interface CreateBody {
  stationId: string;
  stationName: string;
  pdcId?: string | null;
  returnUrl: string;
}

export async function sessionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { sessions } = ctx;

  app.post<{ Body: CreateBody }>('/v1/sessions', { schema: { body: createBody } }, async (req, reply) => {
    const { stationId, pdcId, returnUrl } = req.body;
    // Nettoyage : pas de caractères de contrôle dans le nom affiché.
    const stationName = req.body.stationName.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!stationName) throw badRequest('invalid_body', 'Le nom de la station est requis.');
    if (!ctx.isAllowedReturnUrl(returnUrl)) {
      throw badRequest('invalid_return_url', 'L’adresse de retour n’est pas autorisée.');
    }
    const s = await sessions.create({ stationId, stationName, pdcId: pdcId ?? null, returnUrl });
    reply.code(201).header('cache-control', 'no-store');
    return toDto(s);
  });

  app.get<{ Params: { id: string } }>('/v1/sessions/:id', { schema: { params: idParams } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return toDto(await sessions.get(req.params.id));
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/stop', { schema: { params: idParams } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return toDto(await sessions.stop(req.params.id));
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/cancel', { schema: { params: idParams } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return toDto(await sessions.cancel(req.params.id));
  });

  /**
   * Relais de retour Stripe : Checkout n'accepte que des URL http(s), on redirige donc
   * vers la returnUrl (déjà validée et stockée côté serveur) pour les schémas d'app.
   */
  app.get<{ Params: { id: string }; Querystring: { cancelled?: string } }>(
    '/checkout-return/:id',
    { schema: { params: idParams } },
    async (req, reply) => {
      const s = sessions.find(req.params.id);
      if (!s) throw notFound('Session introuvable.');
      const params: Record<string, string> = { session: s.id };
      if (req.query.cancelled === '1') params.cancelled = '1';
      return reply.code(303).header('cache-control', 'no-store').redirect(withQuery(s.returnUrl, params));
    },
  );
}
