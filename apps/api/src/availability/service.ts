import { fetchWithTimeout, type FetchLike } from '../lib/ttlCache.js';
import { DEFAULT_LIMITS, parseIrveDynamic, type AvailabilityStatus, type ParseLimits, type PdcState } from './parse.js';

export const SOURCE_LABEL =
  'Base nationale consolidée IRVE – données dynamiques (transport.data.gouv.fr / data.gouv.fr, Licence Ouverte 2.0)';

/** Statut plus ancien que 30 min (ou daté du futur de plus de 5 min) → « inconnu ». */
export const MAX_STATUS_AGE_MS = 30 * 60_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** Au-delà, la copie est jugée périmée : feedOk=false (elle reste servie, les statuts vieillissent vers « inconnu »). */
export const FEED_STALE_MS = 15 * 60_000;
/** Polling suspendu après 30 min sans requête (économie de bande passante). */
export const IDLE_STOP_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 90_000;
/** Attente maximale d'un premier téléchargement dans une requête utilisateur. */
const FIRST_LOAD_WAIT_MS = 8_000;
/** Délai minimal entre deux tentatives déclenchées par des requêtes. */
export const RETRY_MS = 30_000;

export interface AvailabilityItem {
  status: AvailabilityStatus;
  /** horodatage de la source (ISO 8601), null si le point de charge est absent du flux. */
  at: string | null;
}

export interface AvailabilityResponse {
  /** Dernier téléchargement réussi (ISO 8601). */
  updatedAt: string | null;
  source: string;
  feedOk: boolean;
  items: Record<string, AvailabilityItem>;
}

interface Snapshot {
  fetchedAt: number;
  index: Map<string, PdcState>;
}

type Log = { warn: (obj: object, msg: string) => void; info?: (obj: object, msg: string) => void };

export interface AvailabilityServiceOptions {
  url: string;
  fetchFn: FetchLike;
  now: () => number;
  refreshMs: number;
  log?: Log;
  limits?: ParseLimits;
  /** Minuterie injectable (tests). */
  setInterval?: (fn: () => void, ms: number) => object;
  clearInterval?: (h: unknown) => void;
}

function wait<T>(p: Promise<T>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([p.then(() => undefined, () => undefined), t]).finally(() => clearTimeout(timer));
}

/**
 * Index mémoire id_pdc_itinerance → statut, rafraîchi périodiquement.
 * Le polling démarre à la première requête (ou au démarrage en production) et s'arrête après 30 min d'inactivité ;
 * une seule requête amont à la fois ; la copie précédente reste servie si la source tombe.
 */
export class AvailabilityService {
  private snapshot: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;
  private timer: unknown = null;
  private lastUse = 0;
  private lastAttempt = -Infinity;

  constructor(private readonly opts: AvailabilityServiceOptions) {}

  private async download(): Promise<Snapshot> {
    const res = await fetchWithTimeout(
      this.opts.fetchFn,
      this.opts.url,
      { method: 'GET', headers: { accept: 'text/csv, */*;q=0.1', 'user-agent': 'branche-api/1.1' }, redirect: 'follow' },
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`flux IRVE dynamique HTTP ${res.status}`);
    }
    const limits = this.opts.limits ?? DEFAULT_LIMITS;
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > limits.maxBytes) {
      await res.body.cancel().catch(() => undefined);
      throw new Error('flux IRVE dynamique trop volumineux');
    }
    const parsed = await parseIrveDynamic(res.body as unknown as AsyncIterable<Uint8Array>, limits);
    if (parsed.index.size === 0) throw new Error('flux IRVE dynamique sans ligne valide');
    this.opts.log?.info?.({ pdc: parsed.index.size, rejected: parsed.rejected }, 'flux IRVE dynamique chargé');
    return { fetchedAt: this.opts.now(), index: parsed.index };
  }

  /** Lance (ou rejoint) un téléchargement ; ne rejette jamais. */
  refresh(): Promise<void> {
    if (!this.inflight) this.lastAttempt = this.opts.now();
    this.inflight ??= this.download().finally(() => {
      this.inflight = null;
    });
    return this.inflight.then(
      (s) => {
        this.snapshot = s;
      },
      (err: unknown) => {
        this.opts.log?.warn({ reason: err instanceof Error ? err.message : 'inconnue' }, 'flux IRVE dynamique indisponible');
      },
    );
  }

  /** Appelée par la minuterie : rafraîchit, ou s'arrête si personne n'interroge l'API. */
  tick(): Promise<void> {
    if (this.opts.now() - this.lastUse > IDLE_STOP_MS) {
      this.stop();
      return Promise.resolve();
    }
    return this.refresh();
  }

  private startPolling(): void {
    if (this.timer) return;
    const si = this.opts.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    const h: { unref?: () => void } = si(() => void this.tick(), this.opts.refreshMs);
    h.unref?.();
    this.timer = h;
  }

  get polling(): boolean {
    return this.timer !== null;
  }

  /** Préchargement (production). */
  warmup(): void {
    this.lastUse = this.opts.now();
    this.startPolling();
    void this.refresh();
  }

  stop(): void {
    if (!this.timer) return;
    (this.opts.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
  }

  private async current(): Promise<Snapshot | null> {
    this.lastUse = this.opts.now();
    this.startPolling();
    const s = this.snapshot;
    // Copie récente : aucune attente (la minuterie s'occupe du rafraîchissement).
    if (s && this.opts.now() - s.fetchedAt < this.opts.refreshMs) return s;
    // Source en échec : pas plus d'une tentative par RETRY_MS, quelle que soit l'affluence.
    const canRetry = this.inflight !== null || this.opts.now() - this.lastAttempt >= RETRY_MS;
    if (s || !canRetry) {
      if (canRetry) void this.refresh();
      return s;
    }
    await wait(this.refresh(), FIRST_LOAD_WAIT_MS);
    return this.snapshot;
  }

  async lookup(ids: string[]): Promise<AvailabilityResponse> {
    const snap = await this.current();
    const t = this.opts.now();
    const items: Record<string, AvailabilityItem> = {};
    for (const id of ids) {
      const st = snap?.index.get(id);
      if (!st) {
        items[id] = { status: 'inconnu', at: null };
        continue;
      }
      const fresh = t - st.at <= MAX_STATUS_AGE_MS && st.at - t <= MAX_FUTURE_SKEW_MS;
      items[id] = { status: fresh ? st.status : 'inconnu', at: new Date(st.at).toISOString() };
    }
    return {
      updatedAt: snap ? new Date(snap.fetchedAt).toISOString() : null,
      source: SOURCE_LABEL,
      feedOk: snap !== null && t - snap.fetchedAt <= FEED_STALE_MS,
      items,
    };
  }
}
