import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../lib/errors.js';
import { haversineM, parseBbox, zoneOf, type LatLon } from '../lib/geo.js';
import { REPORT_TYPES, type IncidentService, type ReportStore, type ReportType } from '../incidents/service.js';
import { RouteProviderError, type RouteProvider } from '../navigation/route.js';

export interface NavigationDeps {
  /** null : aucun fournisseur configuré (production sans clé) → 503. */
  router: RouteProvider | null;
  incidents: IncidentService;
  reports: ReportStore;
}

export const MAX_ROUTE_KM = 1500;
const MAX_BBOX_SPAN_DEG = 20;

const point = {
  type: 'object',
  required: ['lat', 'lon'],
  additionalProperties: false,
  properties: { lat: { type: 'number' }, lon: { type: 'number' } },
} as const;

export const MAX_VIA = 3;

const routeBody = {
  type: 'object',
  required: ['from', 'to'],
  additionalProperties: false,
  properties: {
    from: point,
    to: point,
    via: { type: 'array', maxItems: MAX_VIA, items: point },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: { avoidTolls: { type: 'boolean' }, avoidMotorways: { type: 'boolean' } },
    },
  },
} as const;

interface RouteBody {
  from: LatLon;
  to: LatLon;
  via?: LatLon[];
  options?: { avoidTolls?: boolean; avoidMotorways?: boolean };
}

const reportBody = {
  type: 'object',
  required: ['type', 'lon', 'lat'],
  additionalProperties: false,
  properties: { type: { type: 'string', maxLength: 32 }, lon: { type: 'number' }, lat: { type: 'number' } },
} as const;

function validPoint(p: LatLon, label: string): void {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) {
    throw badRequest('invalid_coordinates', `Coordonnées de ${label} invalides.`);
  }
  if (!zoneOf(p)) throw badRequest('out_of_area', `Le point de ${label} est hors de la zone couverte (France métropolitaine et DOM).`);
}

/** Sel aléatoire par processus : la clé de limitation ne contient pas l'IP en clair. */
const SALT = randomBytes(16);
const hashedIp = (req: FastifyRequest) => createHash('sha256').update(SALT).update(req.ip).digest('base64url').slice(0, 22);

export async function navigationRoutes(app: FastifyInstance, deps: NavigationDeps): Promise<void> {
  app.get('/v1/route', async (_req, reply) => {
    reply.header('allow', 'POST');
    throw new AppError(
      405,
      'method_not_allowed',
      'Utilisez POST /v1/route avec un corps JSON { "from": { "lat", "lon" }, "to": { "lat", "lon" } } : les coordonnées ne doivent pas figurer dans l’URL.',
    );
  });

  app.post<{ Body: RouteBody }>(
    '/v1/route',
    { schema: { body: routeBody }, config: { rateLimit: { max: 20, timeWindow: 60_000, keyGenerator: hashedIp } } },
    async (req, reply) => {
      const { router } = deps;
      if (!router) {
        throw new AppError(503, 'routing_unavailable', 'Le calcul d’itinéraire n’est pas disponible sur ce serveur pour le moment.');
      }
      const { from, to } = req.body;
      const via = req.body.via ?? [];
      const options = { avoidTolls: req.body.options?.avoidTolls === true, avoidMotorways: req.body.options?.avoidMotorways === true };
      validPoint(from, 'départ');
      validPoint(to, 'arrivée');
      via.forEach((v) => validPoint(v, 'étape'));
      const zone = zoneOf(from);
      if (zoneOf(to) !== zone || via.some((v) => zoneOf(v) !== zone)) {
        throw badRequest('out_of_area', 'Le départ, les étapes et l’arrivée doivent être dans le même territoire.');
      }
      const d = haversineM(from, to);
      const pts = [from, ...via, to];
      const legs = pts.slice(1).reduce((acc, p, i) => acc + haversineM(pts[i]!, p), 0);
      if (Math.max(d, legs) > MAX_ROUTE_KM * 1000) throw badRequest('too_far', `Trajet trop long : ${MAX_ROUTE_KM} km maximum à vol d’oiseau.`);
      if (d < 10) throw badRequest('same_point', 'Le départ et l’arrivée sont identiques.');
      // Pas de cache partagé : les conditions TomTom l'interdisent ; réponse privée et non stockée.
      reply.header('cache-control', 'no-store');
      try {
        return await router.route({ from, to, via, options });
      } catch (err) {
        if (err instanceof RouteProviderError) {
          req.log.warn({ provider: err.provider, reason: err.reason }, 'échec du fournisseur d’itinéraire');
        } else {
          req.log.warn({ provider: router.name }, 'erreur inattendue du fournisseur d’itinéraire');
        }
        throw new AppError(502, 'route_provider_error', 'Le service d’itinéraire est indisponible, réessayez dans quelques instants.');
      }
    },
  );

  app.get<{ Querystring: { bbox?: string } }>('/v1/incidents', async (req, reply) => {
    const bbox = parseBbox(req.query.bbox);
    if (!bbox) throw badRequest('invalid_bbox', 'Paramètre bbox invalide : attendu « ouest,sud,est,nord » en degrés décimaux.');
    if (bbox.e - bbox.w > MAX_BBOX_SPAN_DEG || bbox.n - bbox.s > MAX_BBOX_SPAN_DEG) {
      throw badRequest('bbox_too_large', `Zone trop grande : ${MAX_BBOX_SPAN_DEG}° maximum de côté.`);
    }
    reply.header('cache-control', 'public, max-age=60');
    return deps.incidents.list(bbox);
  });

  app.post<{ Body: { type: string; lon: number; lat: number } }>(
    '/v1/reports',
    {
      schema: { body: reportBody },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 3600_000,
          keyGenerator: hashedIp,
          errorResponseBuilder: () => new AppError(429, 'rate_limited', 'Trop de signalements : 10 par heure maximum.'),
        },
      },
    },
    async (req, reply) => {
      const { type, lon, lat } = req.body;
      if (!(REPORT_TYPES as readonly string[]).includes(type)) {
        throw badRequest('invalid_report_type', `Type de signalement non pris en charge. Types acceptés : ${REPORT_TYPES.join(', ')}.`);
      }
      validPoint({ lat, lon }, 'signalement');
      if (deps.reports.isDisabledAt(lon, lat)) {
        throw new AppError(403, 'reports_disabled', 'Les signalements sont temporairement suspendus dans cette zone (décision des autorités).');
      }
      const r = deps.reports.add(type as ReportType, lon, lat, type === 'qr_suspect' ? hashedIp(req) : undefined);
      reply.code(201).header('cache-control', 'no-store');
      return { id: r.id, expiresAt: new Date(r.expiresAt).toISOString() };
    },
  );
}
