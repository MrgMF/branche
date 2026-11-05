import { randomUUID } from 'node:crypto';

/**
 * Retours anonymes « Ça a marché ? » après une recharge (fiabilité communautaire, prix constatés).
 * Mémoire uniquement, comme les signalements : identifiant de station, résultat, montants facultatifs, date.
 * Aucune IP, aucun identifiant d'appareil. L'empreinte anti-doublon (sel aléatoire par processus) est gardée
 * à part, au plus DEDUP_MS, puis oubliée.
 */
export interface CheckinInput {
  stationId: string;
  ok: boolean;
  /** Montant payé (€ TTC) lu sur le ticket ou la page de l'opérateur. */
  pricePaid?: number;
  /** Énergie (kWh) affichée par la borne ou le ticket. */
  kWh?: number;
  /** Montant bloqué (pré-autorisation, €) affiché par la borne ou la banque. */
  preauth?: number;
}

interface Checkin {
  id: string;
  stationId: string;
  ok: boolean;
  pricePaid?: number;
  kWh?: number;
  preauth?: number;
  at: number;
}

export interface CommunityStats {
  stationId: string;
  windowDays: number;
  checkins: number;
  okCount: number;
  /** Part des recharges réussies sur la fenêtre (0 à 1), null sans retour. */
  successRate: number | null;
  /** Dates (jour seulement, AAAA-MM-JJ) du dernier succès / échec. */
  lastOkAt: string | null;
  lastFailAt: string | null;
  /** Derniers prix constatés, du plus récent au plus ancien. */
  recentPrices: { pricePaid: number; kWh: number | null; pricePerKwh: number | null; date: string }[];
  /** Pré-autorisations constatées : médiane et nombre. */
  preauth: { median: number; count: number; lastDate: string } | null;
}

const DAY = 86_400_000;
export const CHECKIN_TTL_MS = 90 * DAY;
export const COMMUNITY_WINDOW_DAYS = 30;
export const DEDUP_MS = 6 * 3600_000;
const MAX_PRICES = 5;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export class CheckinStore {
  private readonly byStation = new Map<string, Checkin[]>();
  /** empreinte (station + appareil, salée) → fin de la fenêtre anti-doublon. */
  private readonly recent = new Map<string, { id: string; until: number }>();
  private total = 0;

  constructor(
    private readonly now: () => number,
    private readonly max = 50_000,
  ) {}

  /** Enregistre un retour. `duplicate` : même empreinte pour la même station dans les DEDUP_MS (non compté). */
  add(input: CheckinInput, fingerprint: string): { id: string; duplicate: boolean } {
    this.prune();
    const t = this.now();
    const prev = this.recent.get(fingerprint);
    if (prev && prev.until > t) return { id: prev.id, duplicate: true };
    if (this.total >= this.max) this.dropOldest();
    const c: Checkin = { id: `ck-${randomUUID()}`, stationId: input.stationId, ok: input.ok, at: t };
    if (input.pricePaid !== undefined) c.pricePaid = r2(input.pricePaid);
    if (input.kWh !== undefined) c.kWh = r2(input.kWh);
    if (input.preauth !== undefined) c.preauth = r2(input.preauth);
    const list = this.byStation.get(input.stationId) ?? [];
    list.push(c);
    this.byStation.set(input.stationId, list);
    this.total++;
    this.recent.set(fingerprint, { id: c.id, until: t + DEDUP_MS });
    return { id: c.id, duplicate: false };
  }

  stats(stationId: string): CommunityStats {
    this.prune();
    const t = this.now();
    const all = this.byStation.get(stationId) ?? [];
    const win = all.filter((c) => c.at > t - COMMUNITY_WINDOW_DAYS * DAY);
    const okCount = win.filter((c) => c.ok).length;
    const last = (ok: boolean) => {
      const c = [...all].reverse().find((x) => x.ok === ok);
      return c ? day(c.at) : null;
    };
    const priced = [...all].reverse().filter((c) => c.pricePaid !== undefined).slice(0, MAX_PRICES);
    const pre = all.filter((c) => c.preauth !== undefined && c.preauth > 0);
    return {
      stationId,
      windowDays: COMMUNITY_WINDOW_DAYS,
      checkins: win.length,
      okCount,
      successRate: win.length ? r2(okCount / win.length) : null,
      lastOkAt: last(true),
      lastFailAt: last(false),
      recentPrices: priced.map((c) => ({
        pricePaid: c.pricePaid as number,
        kWh: c.kWh ?? null,
        pricePerKwh: c.kWh && c.kWh >= 1 ? r2((c.pricePaid as number) / c.kWh) : null,
        date: day(c.at),
      })),
      preauth: pre.length
        ? { median: r2(median(pre.map((c) => c.preauth as number))), count: pre.length, lastDate: day((pre[pre.length - 1] as Checkin).at) }
        : null,
    };
  }

  size(): number {
    this.prune();
    return this.total;
  }

  private dropOldest(): void {
    let oldest: { key: string; at: number } | null = null;
    for (const [key, list] of this.byStation) {
      const first = list[0];
      if (first && (!oldest || first.at < oldest.at)) oldest = { key, at: first.at };
    }
    if (!oldest) return;
    const list = this.byStation.get(oldest.key) as Checkin[];
    list.shift();
    this.total--;
    if (!list.length) this.byStation.delete(oldest.key);
  }

  private prune(): void {
    const t = this.now();
    for (const [fp, r] of this.recent) if (r.until <= t) this.recent.delete(fp);
    for (const [key, list] of this.byStation) {
      const keep = list.filter((c) => c.at > t - CHECKIN_TTL_MS);
      this.total -= list.length - keep.length;
      if (keep.length) this.byStation.set(key, keep);
      else this.byStation.delete(key);
    }
  }
}
