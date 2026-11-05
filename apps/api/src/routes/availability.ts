import type { FastifyInstance } from 'fastify';
import { loadAvailabilityConfig } from '../availability/config.js';
import { normalizePdcId } from '../availability/parse.js';
import { AvailabilityService } from '../availability/service.js';
import { AppError, badRequest } from '../lib/errors.js';
import type { FetchLike } from '../lib/ttlCache.js';

export const MAX_IDS = 200;
const RAW_ID_RE = /^[A-Za-z0-9*]{1,64}$/;

export interface AvailabilityDeps {
  fetchFn: FetchLike;
  now: () => number;
  log?: { warn: (obj: object, msg: string) => void; info?: (obj: object, msg: string) => void };
  /** Environnement (défaut : process.env). */
  env?: Record<string, string | undefined>;
  /** Service injecté (tests). */
  service?: AvailabilityService | null;
}

/** `ids=FR...,FR...` → identifiants normalisés, dédoublonnés ; erreurs 400 explicites. */
export function parseIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw badRequest('invalid_ids', 'Paramètre ids requis : identifiants id_pdc_itinerance séparés par des virgules.');
  }
  const parts = raw.split(',');
  if (parts.length > MAX_IDS) throw badRequest('too_many_ids', `Trop d’identifiants : ${MAX_IDS} maximum par requête.`);
  const out = new Set<string>();
  for (const p of parts) {
    const t = p.trim();
    const id = RAW_ID_RE.test(t) ? normalizePdcId(t) : null;
    // Le message ne recopie pas la valeur reçue.
    if (!id) throw badRequest('invalid_ids', 'Identifiant de point de charge invalide (format id_pdc_itinerance attendu, ex. FRS01E0001).');
    out.add(id);
  }
  return [...out];
}

export async function availabilityRoutes(app: FastifyInstance, deps: AvailabilityDeps): Promise<void> {
  const cfg = loadAvailabilityConfig(deps.env);
  const service =
    deps.service !== undefined
      ? deps.service
      : cfg.url
        ? new AvailabilityService({ url: cfg.url, fetchFn: deps.fetchFn, now: deps.now, refreshMs: cfg.refreshMs, log: deps.log })
        : null;

  if (service && cfg.warmup) app.addHook('onReady', async () => service.warmup());
  if (service) app.addHook('onClose', async () => service.stop());

  app.get<{ Querystring: Record<string, unknown> }>(
    '/v1/availability',
    // logLevel warn : pas de journal « incoming request » contenant les identifiants demandés.
    { logLevel: 'warn' },
    async (req, reply) => {
      const q = req.query;
      if (Object.keys(q).some((k) => k !== 'ids')) throw badRequest('invalid_query', 'Seul le paramètre ids est accepté.');
      const ids = parseIds(q.ids);
      if (!service) {
        throw new AppError(503, 'availability_disabled', 'La disponibilité en temps réel n’est pas activée sur ce serveur.');
      }
      const body = await service.lookup(ids);
      reply.header('cache-control', 'public, max-age=30');
      return body;
    },
  );
}
