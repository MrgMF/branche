export type SessionStatus = 'awaiting_payment' | 'starting' | 'charging' | 'completed' | 'cancelled' | 'failed';

/** Enregistrement interne (jamais exposé tel quel). Aucune donnée de carte. */
export interface SessionRecord {
  id: string;
  status: SessionStatus;
  stationId: string;
  stationName: string;
  pdcId: string | null;
  returnUrl: string;
  checkoutUrl: string;
  checkoutId: string | null;
  /** Référence opaque de l'autorisation (PaymentIntent Stripe ou mock). */
  paymentRef: string | null;
  demo: boolean;
  priceCentsPerKwh: number;
  feeCents: number;
  preauthCents: number;
  energyWh: number;
  powerKw: number;
  costCents: number;
  totalCents: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  error: { code: string; message: string } | null;
  /** Clé d'idempotence de la capture finale. */
  captureKey: string;
  settled: boolean;
  /** Dernière vérification de la page de paiement côté prestataire (ms). */
  checkoutCheckedAt: number;
}

/** Représentation publique conforme au contrat. */
export interface SessionDto {
  id: string;
  status: SessionStatus;
  stationId: string;
  stationName: string;
  pdcId: string | null;
  checkoutUrl: string;
  demo: boolean;
  priceCentsPerKwh: number;
  feeCents: number;
  preauthCents: number;
  energyWh: number;
  powerKw: number;
  costCents: number;
  totalCents: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  error: { code: string; message: string } | null;
}

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

export function toDto(s: SessionRecord): SessionDto {
  return {
    id: s.id,
    status: s.status,
    stationId: s.stationId,
    stationName: s.stationName,
    pdcId: s.pdcId,
    checkoutUrl: s.checkoutUrl,
    demo: s.demo,
    priceCentsPerKwh: s.priceCentsPerKwh,
    feeCents: s.feeCents,
    preauthCents: s.preauthCents,
    energyWh: s.energyWh,
    powerKw: s.powerKw,
    costCents: s.costCents,
    totalCents: s.totalCents,
    createdAt: iso(s.createdAt) as string,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    error: s.error,
  };
}

export interface SessionStore {
  get(id: string): SessionRecord | undefined;
  findByCheckoutId(checkoutId: string): SessionRecord | undefined;
  save(s: SessionRecord): void;
  size(): number;
}

/**
 * Stockage en mémoire (V1, une seule instance). Les sessions terminées sont purgées
 * après `retentionMs` ; taille bornée pour éviter l'épuisement mémoire.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly byId = new Map<string, SessionRecord>();
  private readonly byCheckout = new Map<string, string>();

  constructor(
    private readonly opts: { maxSessions?: number; retentionMs?: number; now?: () => number } = {},
  ) {}

  get(id: string): SessionRecord | undefined {
    return this.byId.get(id);
  }

  findByCheckoutId(checkoutId: string): SessionRecord | undefined {
    const id = this.byCheckout.get(checkoutId);
    return id ? this.byId.get(id) : undefined;
  }

  save(s: SessionRecord): void {
    if (!this.byId.has(s.id)) this.prune();
    this.byId.set(s.id, s);
    if (s.checkoutId) this.byCheckout.set(s.checkoutId, s.id);
  }

  size(): number {
    return this.byId.size;
  }

  private prune(): void {
    const now = (this.opts.now ?? Date.now)();
    const retention = this.opts.retentionMs ?? 24 * 3600 * 1000;
    const max = this.opts.maxSessions ?? 10_000;
    for (const [id, s] of this.byId) {
      const finished = s.endedAt !== null && now - s.endedAt > retention;
      const stale = s.status === 'awaiting_payment' && now - s.createdAt > retention;
      if (finished || stale) this.delete(id);
    }
    // Map conserve l'ordre d'insertion : on évince les plus anciennes terminées d'abord.
    if (this.byId.size >= max) {
      for (const [id, s] of this.byId) {
        if (this.byId.size < max) break;
        if (s.endedAt !== null) this.delete(id);
      }
    }
    if (this.byId.size >= max) {
      throw Object.assign(new Error('Capacité de sessions atteinte.'), { capacity: true });
    }
  }

  private delete(id: string): void {
    const s = this.byId.get(id);
    if (s?.checkoutId) this.byCheckout.delete(s.checkoutId);
    this.byId.delete(id);
  }
}
