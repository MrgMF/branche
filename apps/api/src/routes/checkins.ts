import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../lib/errors.js';
import type { CheckinInput, CheckinStore } from '../checkins/store.js';

// Identifiant de station tel que publié par le pipeline (itinérance, local, ou clé de repli) : imprimable, borné.
const STATION_ID = /^[^\u0000-\u001f\u007f]{3,120}$/;

const checkinBody = {
  type: 'object',
  required: ['stationId', 'ok'],
  additionalProperties: false,
  properties: {
    stationId: { type: 'string', minLength: 3, maxLength: 120 },
    ok: { type: 'boolean' },
    pricePaid: { type: 'number', minimum: 0, maximum: 500 },
    kWh: { type: 'number', minimum: 0, maximum: 300 },
    preauth: { type: 'number', minimum: 0, maximum: 500 },
  },
} as const;

/** Sel aléatoire par processus (jamais persisté) : ni l'IP ni l'empreinte ne sont lisibles après redémarrage. */
const SALT = randomBytes(16);
const hash = (...parts: string[]) => {
  const h = createHash('sha256').update(SALT);
  for (const p of parts) h.update('\u0000').update(p);
  return h.digest('base64url').slice(0, 22);
};
const hashedIp = (req: FastifyRequest) => hash('ip', req.ip);

export async function checkinRoutes(app: FastifyInstance, deps: { checkins: CheckinStore }): Promise<void> {
  app.post<{ Body: CheckinInput }>(
    '/v1/checkins',
    {
      schema: { body: checkinBody },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 3600_000,
          keyGenerator: hashedIp,
          errorResponseBuilder: () => new AppError(429, 'rate_limited', 'Trop de retours : 10 par heure maximum.'),
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (!STATION_ID.test(b.stationId)) throw badRequest('invalid_station', 'Identifiant de station invalide.');
      const input: CheckinInput = { stationId: b.stationId, ok: b.ok };
      if (b.pricePaid !== undefined) input.pricePaid = b.pricePaid;
      if (b.kWh !== undefined) input.kWh = b.kWh;
      if (b.preauth !== undefined) input.preauth = b.preauth;
      // Anti-doublon : même appareil (IP salée) + même station, une fois par fenêtre.
      const r = deps.checkins.add(input, hash('checkin', req.ip, b.stationId));
      reply.code(r.duplicate ? 200 : 201).header('cache-control', 'no-store');
      return { id: r.id, duplicate: r.duplicate };
    },
  );

  app.get<{ Params: { id: string } }>('/v1/stations/:id/community', async (req, reply) => {
    const id = req.params.id;
    if (!STATION_ID.test(id)) throw badRequest('invalid_station', 'Identifiant de station invalide.');
    reply.header('cache-control', 'public, max-age=60');
    return deps.checkins.stats(id);
  });
}
