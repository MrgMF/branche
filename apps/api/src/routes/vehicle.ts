import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../lib/errors.js';
import { availabilityEnabled } from '../availability/config.js';
import { IdentifyError, type IdentifyMediaType, type VehicleIdentifier } from '../vehicles/identify.js';

export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

const body = {
  type: 'object',
  required: ['image', 'mediaType'],
  additionalProperties: false,
  properties: {
    // base64 de ≤ 1,5 Mo ≈ 2 097 152 caractères
    image: { type: 'string', minLength: 100, maxLength: 2_100_000 },
    mediaType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
  },
} as const;

const SALT = randomBytes(16);
const hashedIp = (req: FastifyRequest) => createHash('sha256').update(SALT).update(req.ip).digest('base64url').slice(0, 22);

/** POST /v1/vehicle/identify : photo → identifiant VEHICLES ou null. Sans identifiant configuré : 503. */
export async function vehicleRoutes(app: FastifyInstance, deps: { identifier: VehicleIdentifier | null }): Promise<void> {
  app.post<{ Body: { image: string; mediaType: IdentifyMediaType } }>(
    '/v1/vehicle/identify',
    {
      bodyLimit: 2_200_000,
      schema: { body },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 3600_000,
          keyGenerator: hashedIp,
          errorResponseBuilder: () => new AppError(429, 'rate_limited', 'Trop de photos : 10 par heure maximum.'),
        },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      if (!deps.identifier) throw new AppError(503, 'vehicle_identify_unavailable', 'La reconnaissance par photo n’est pas disponible sur ce serveur.');
      const { image, mediaType } = req.body;
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw badRequest('invalid_image', 'Image invalide (base64 attendu).');
      if (Math.floor((image.length * 3) / 4) > MAX_IMAGE_BYTES) throw new AppError(413, 'image_too_large', 'Image trop lourde : 1,5 Mo maximum.');
      try {
        return await deps.identifier.identify(image, mediaType);
      } catch (err) {
        // Jamais l'image ni le corps dans les journaux
        req.log.warn({ reason: err instanceof IdentifyError ? err.message : 'inconnue' }, 'échec de l’identification du véhicule');
        throw new AppError(502, 'identify_failed', 'Reconnaissance impossible pour le moment : choisissez votre modèle dans la liste.');
      }
    },
  );
}

/** GET /v1/meta : fonctions disponibles sur ce serveur (l'app masque ce qui ne l'est pas). */
export async function featureRoutes(app: FastifyInstance, deps: { identifier: VehicleIdentifier | null }): Promise<void> {
  app.get('/v1/meta', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { v: 2, features: { vehicleIdentify: !!deps.identifier, checkins: true, availability: availabilityEnabled() } };
  });
}
