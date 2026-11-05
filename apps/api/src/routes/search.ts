import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../lib/errors.js';
import { zoneOf, type LatLon } from '../lib/geo.js';
import { SearchProviderError, type SearchProvider } from '../search/service.js';

export interface SearchDeps {
  /** null : aucun fournisseur (PHOTON_URL=off sans clé TomTom) → 503. */
  search: SearchProvider | null;
}

const body = {
  type: 'object',
  required: ['q'],
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 200 },
    near: {
      type: 'object',
      required: ['lat', 'lon'],
      additionalProperties: false,
      properties: { lat: { type: 'number' }, lon: { type: 'number' } },
    },
  },
} as const;

const SALT = randomBytes(16);
const hashedIp = (req: FastifyRequest) => createHash('sha256').update(SALT).update(req.ip).digest('base64url').slice(0, 22);

export const SEARCH_RATE_PER_MIN = 30;

/** POST (et non GET) : la saisie, donnée personnelle (adresse du domicile…), ne figure jamais dans une URL ni un journal. */
export async function searchRoutes(app: FastifyInstance, deps: SearchDeps): Promise<void> {
  app.post<{ Body: { q: string; near?: LatLon } }>(
    '/v1/search',
    {
      schema: { body },
      config: {
        rateLimit: {
          max: SEARCH_RATE_PER_MIN,
          timeWindow: 60_000,
          keyGenerator: hashedIp,
          errorResponseBuilder: () => new AppError(429, 'rate_limited', 'Trop de recherches, réessayez dans une minute.'),
        },
      },
    },
    async (req, reply) => {
      const q = req.body.q.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (q.length < 2) throw badRequest('query_too_short', 'Saisissez au moins 2 caractères.');
      if (q.length > 120) throw badRequest('query_too_long', 'Recherche trop longue : 120 caractères maximum.');
      let near = req.body.near;
      if (near && (!Number.isFinite(near.lat) || !Number.isFinite(near.lon) || Math.abs(near.lat) > 90 || Math.abs(near.lon) > 180)) {
        throw badRequest('invalid_coordinates', 'Position de référence invalide.');
      }
      if (near && !zoneOf(near)) near = undefined; // hors zone : recherche nationale, sans biais
      if (!deps.search) throw new AppError(503, 'search_unavailable', 'La recherche d’adresse n’est pas disponible sur ce serveur pour le moment.');
      reply.header('cache-control', 'no-store');
      try {
        return await deps.search.search(q, near);
      } catch (err) {
        // Jamais la requête ni la position dans les journaux.
        const reason = err instanceof SearchProviderError ? err.reason : 'erreur inattendue';
        req.log.warn({ provider: deps.search.name, reason }, 'échec du fournisseur de recherche');
        throw new AppError(502, 'search_provider_error', 'La recherche d’adresse est indisponible, réessayez dans quelques instants.');
      }
    },
  );
  app.get('/v1/search', async (_req, reply) => {
    reply.header('allow', 'POST');
    throw new AppError(405, 'method_not_allowed', 'Utilisez POST /v1/search avec un corps JSON { "q": "…", "near": { "lat", "lon" } } : la saisie ne doit pas figurer dans l’URL.');
  });
}
