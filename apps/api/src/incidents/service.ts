import { randomUUID } from 'node:crypto';
import type { ReportsDisabledZone } from '../config.js';
import { inBbox, round, type BBox } from '../lib/geo.js';
import { fetchWithTimeout, type FetchLike } from '../lib/ttlCache.js';
import { createDatexParser, parseDatex, type Incident, type IncidentType } from './datex.js';

export const REPORT_TYPES = ['accident', 'travaux', 'obstacle', 'bouchon', 'borne_hs', 'qr_suspect'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const HOUR = 3600_000;
const REPORT_TTL: Record<ReportType, number> = {
  accident: HOUR,
  travaux: HOUR,
  obstacle: HOUR,
  bouchon: HOUR,
  borne_hs: 24 * HOUR,
  qr_suspect: 7 * 24 * HOUR,
};
const REPORT_INCIDENT: Record<ReportType, { type: IncidentType; title: string; severity: 1 | 2 | 3 }> = {
  accident: { type: 'accident', title: 'Accident signalé', severity: 3 },
  travaux: { type: 'travaux', title: 'Travaux signalés', severity: 1 },
  obstacle: { type: 'obstacle', title: 'Obstacle signalé', severity: 2 },
  bouchon: { type: 'bouchon', title: 'Bouchon signalé', severity: 2 },
  borne_hs: { type: 'autre', title: 'Borne hors service signalée', severity: 1 },
  qr_suspect: { type: 'autre', title: 'QR code suspect signalé', severity: 3 },
};

const REPORT_DESCRIPTION: Partial<Record<ReportType, string>> = {
  qr_suspect: 'Un usager signale un QR code possiblement frauduleux sur une borne. Ne le scannez pas : payez par l’app de l’opérateur ou par carte.',
};

/**
 * Signalement communautaire. Volontairement minimal : type, position, horodatage.
 * Aucune IP, aucun identifiant d'appareil ni de compte.
 */
interface Report {
  id: string;
  type: ReportType;
  lon: number;
  lat: number;
  createdAt: number;
  expiresAt: number;
}

export class ReportStore {
  private readonly byId = new Map<string, Report>();

  constructor(
    private readonly now: () => number,
    private readonly disabledZones: ReportsDisabledZone[] = [],
    private readonly max = 5000,
  ) {}

  /** Vrai si un point est dans une zone où les signalements sont suspendus (à l'instant présent). */
  isDisabledAt(lon: number, lat: number): boolean {
    const t = this.now();
    return this.disabledZones.some((z) => t < z.until && lon >= z.w && lon <= z.e && lat >= z.s && lat <= z.n);
  }

  add(type: ReportType, lon: number, lat: number): Report {
    this.prune();
    if (this.byId.size >= this.max) {
      const oldest = this.byId.keys().next().value;
      if (oldest !== undefined) this.byId.delete(oldest);
    }
    const t = this.now();
    // Position arrondie à ~11 m : suffisant pour l'alerte, limite la précision stockée.
    const r: Report = { id: `cm-${randomUUID()}`, type, lon: round(lon, 4), lat: round(lat, 4), createdAt: t, expiresAt: t + REPORT_TTL[type] };
    this.byId.set(r.id, r);
    return r;
  }

  active(): Incident[] {
    this.prune();
    return [...this.byId.values()].filter((r) => !this.isDisabledAt(r.lon, r.lat)).map((r) => {
      const m = REPORT_INCIDENT[r.type];
      return {
        id: r.id,
        type: m.type,
        title: m.title,
        description: REPORT_DESCRIPTION[r.type] ?? 'Signalement d’un usager de Branché, non vérifié.',
        lon: r.lon,
        lat: r.lat,
        start: new Date(r.createdAt).toISOString(),
        end: new Date(r.expiresAt).toISOString(),
        severity: m.severity,
        source: 'communaute' as const,
      };
    });
  }

  private prune(): void {
    const t = this.now();
    for (const [id, r] of this.byId) if (r.expiresAt <= t) this.byId.delete(id);
  }
}

export interface IncidentsResponse {
  updatedAt: string | null;
  source: string;
  /** false si le flux Bison Futé est indisponible et qu'aucune copie n'est en cache. */
  feedOk: boolean;
  incidents: Incident[];
}

export const SOURCE_LABEL = 'Bison Futé / DIR, DATEX II (Licence Ouverte 2.0) ; signalements communautaires';

const FEED_TTL_MS = 2 * 60_000;
const FEED_TIMEOUT_MS = 20_000;
const FEED_MAX_BYTES = 40 * 1024 * 1024;
const MAX_RESULTS = 500;

interface FeedSnapshot {
  fetchedAt: number;
  updatedAt: string | null;
  incidents: Incident[];
}

export class IncidentService {
  private snapshot: FeedSnapshot | null = null;
  private inflight: Promise<FeedSnapshot> | null = null;
  private readonly parser = createDatexParser();

  constructor(
    private readonly opts: {
      url: string;
      fetchFn: FetchLike;
      now: () => number;
      reports: ReportStore;
      log?: { warn: (obj: object, msg: string) => void };
    },
  ) {}

  private async fetchFeed(): Promise<FeedSnapshot> {
    const res = await fetchWithTimeout(
      this.opts.fetchFn,
      this.opts.url,
      { method: 'GET', headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.1', 'user-agent': 'branche-api/1.1' }, redirect: 'follow' },
      FEED_TIMEOUT_MS,
    );
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`flux incidents HTTP ${res.status}`);
    }
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > FEED_MAX_BYTES) throw new Error('flux incidents trop volumineux');
    const xml = await res.text();
    if (xml.length > FEED_MAX_BYTES) throw new Error('flux incidents trop volumineux');
    const parsed = parseDatex(xml, this.parser);
    return { fetchedAt: this.opts.now(), updatedAt: parsed.publicationTime, incidents: parsed.incidents };
  }

  /** Copie en cache (2 min), une seule requête amont à la fois ; copie périmée servie si l'amont échoue. */
  private async feed(): Promise<FeedSnapshot | null> {
    const s = this.snapshot;
    if (s && this.opts.now() - s.fetchedAt < FEED_TTL_MS) return s;
    this.inflight ??= this.fetchFeed().finally(() => {
      this.inflight = null;
    });
    try {
      this.snapshot = await this.inflight;
      return this.snapshot;
    } catch (err) {
      this.opts.log?.warn({ reason: err instanceof Error ? err.message : 'inconnue' }, 'flux Bison Futé indisponible');
      return s;
    }
  }

  async list(bbox: BBox): Promise<IncidentsResponse> {
    const snap = await this.feed();
    const t = this.opts.now();
    const active = (i: Incident) => !i.end || Date.parse(i.end) > t;
    const sorted = [...this.opts.reports.active(), ...(snap?.incidents ?? [])]
      .filter((i) => active(i) && inBbox(bbox, i.lon, i.lat))
      .sort((a, b) => b.severity - a.severity);
    return {
      updatedAt: snap?.updatedAt ?? (snap ? new Date(snap.fetchedAt).toISOString() : null),
      source: SOURCE_LABEL,
      feedOk: snap !== null,
      incidents: sorted.slice(0, MAX_RESULTS),
    };
  }
}
