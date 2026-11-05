import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { ChargerAdapter } from '../chargers/types.js';
import type { Config } from '../config.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import type { PaymentProvider, WebhookEvent } from '../payments/types.js';
import type { SessionRecord, SessionStore } from './store.js';

export interface CreateSessionInput {
  stationId: string;
  stationName: string;
  pdcId?: string | null;
  returnUrl: string;
}

export interface SessionServiceDeps {
  config: Config;
  store: SessionStore;
  payment: PaymentProvider;
  charger: ChargerAdapter;
  now: () => number;
  log: FastifyBaseLogger;
}

const SESSION_ID = /^ses_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function computeCost(energyWh: number, priceCentsPerKwh: number, feeCents: number, preauthCents: number) {
  const costCents = Math.round((energyWh / 1000) * priceCentsPerKwh);
  const totalCents = Math.min(costCents + feeCents, preauthCents);
  return { costCents, totalCents, capReached: costCents + feeCents >= preauthCents };
}

/** Énergie maximale facturable sous la pré-autorisation (Wh). */
export function maxEnergyWh(priceCentsPerKwh: number, feeCents: number, preauthCents: number): number {
  return ((preauthCents - feeCents) / priceCentsPerKwh) * 1000;
}

export class SessionService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly d: SessionServiceDeps) {}

  /** Sérialise les opérations par session (évite double démarrage / double capture). */
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  find(id: string): SessionRecord | undefined {
    if (!SESSION_ID.test(id)) return undefined;
    return this.d.store.get(id);
  }

  private require(id: string): SessionRecord {
    const s = this.find(id);
    if (!s) throw notFound('Session introuvable.');
    return s;
  }

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const { config, payment, now } = this.d;
    const id = `ses_${randomUUID()}`;
    const t = now();
    const checkout = await payment
      .createCheckout({ sessionId: id, stationName: input.stationName, amountCents: config.preauthCents, returnUrl: input.returnUrl })
      .catch((err: unknown) => {
        this.d.log.error({ err, sessionId: id }, 'création du paiement impossible');
        throw new AppError(502, 'payment_unavailable', 'Le service de paiement est indisponible. Réessayez dans un instant.');
      });
    const record: SessionRecord = {
      id,
      status: 'awaiting_payment',
      stationId: input.stationId,
      stationName: input.stationName,
      pdcId: input.pdcId ?? null,
      returnUrl: input.returnUrl,
      checkoutUrl: checkout.checkoutUrl,
      checkoutId: checkout.checkoutId,
      paymentRef: null,
      demo: config.paymentProvider === 'mock',
      priceCentsPerKwh: config.priceCentsPerKwh,
      feeCents: config.feeCents,
      preauthCents: config.preauthCents,
      energyWh: 0,
      powerKw: 0,
      costCents: 0,
      totalCents: 0,
      createdAt: t,
      startedAt: null,
      endedAt: null,
      error: null,
      captureKey: `capture_${id}`,
      settled: false,
      checkoutCheckedAt: 0,
    };
    try {
      this.d.store.save(record);
    } catch {
      throw new AppError(503, 'capacity_reached', 'Service saturé, réessayez plus tard.');
    }
    return record;
  }

  /** Lecture avec mise à jour paresseuse (compteurs, arrêt auto, rattrapage Stripe). */
  async get(id: string): Promise<SessionRecord> {
    const s = this.require(id);
    return this.withLock(id, () => this.refresh(s));
  }

  private async refresh(s: SessionRecord): Promise<SessionRecord> {
    if (s.status === 'awaiting_payment') {
      if (s.checkoutId) {
        // Rattrapage si le webhook n'arrive pas, limité à un appel Stripe toutes les 3 s.
        if (this.d.now() - s.checkoutCheckedAt < 3000) return s;
        s.checkoutCheckedAt = this.d.now();
        try {
          const state = await this.d.payment.getCheckout(s.checkoutId);
          if (state.state === 'complete') return this.authorize(s, state.paymentRef);
          if (state.state === 'expired') return this.markCancelled(s, 'checkout_expired', 'La page de paiement a expiré.');
        } catch (err) {
          this.d.log.warn({ err, sessionId: s.id }, 'vérification Checkout impossible');
        }
      } else if (this.d.now() - s.createdAt > this.d.config.checkoutTtlMs) {
        return this.markCancelled(s, 'checkout_expired', 'La pré-autorisation n’a pas été validée à temps.');
      }
      return s;
    }
    if (s.status === 'charging') {
      const reading = await this.d.charger.read(s.id);
      this.apply(s, reading.energyWh, reading.powerKw);
      const capWh = Math.floor(maxEnergyWh(s.priceCentsPerKwh, s.feeCents, s.preauthCents));
      if (computeCost(s.energyWh, s.priceCentsPerKwh, s.feeCents, s.preauthCents).capReached || s.energyWh >= capWh) {
        return this.finish(s);
      }
      return s;
    }
    if (s.status === 'completed' && !s.settled) await this.settle(s);
    return s;
  }

  private apply(s: SessionRecord, energyWh: number, powerKw: number): void {
    s.energyWh = energyWh;
    s.powerKw = powerKw;
    const c = computeCost(energyWh, s.priceCentsPerKwh, s.feeCents, s.preauthCents);
    s.costCents = c.costCents;
    s.totalCents = c.totalCents;
  }

  /** Pré-autorisation obtenue : starting → démarrage de la borne → charging. Idempotent. */
  private async authorize(s: SessionRecord, paymentRef: string): Promise<SessionRecord> {
    if (s.status !== 'awaiting_payment') return s;
    s.paymentRef = paymentRef;
    s.status = 'starting';
    this.d.store.save(s);
    try {
      await this.d.charger.start({
        sessionId: s.id,
        stationId: s.stationId,
        pdcId: s.pdcId,
        maxEnergyWh: maxEnergyWh(s.priceCentsPerKwh, s.feeCents, s.preauthCents),
      });
    } catch (err) {
      this.d.log.error({ err, sessionId: s.id }, 'démarrage borne impossible');
      s.status = 'failed';
      s.endedAt = this.d.now();
      s.error = { code: 'charger_start_failed', message: 'La borne n’a pas pu démarrer. Aucun montant ne sera débité.' };
      s.totalCents = 0;
      await this.settle(s);
      return s;
    }
    s.status = 'charging';
    s.startedAt = this.d.now();
    this.apply(s, 0, 0);
    this.d.store.save(s);
    return s;
  }

  async authorizeMock(id: string): Promise<SessionRecord> {
    if (this.d.payment.name !== 'mock') throw notFound();
    const s = this.require(id);
    return this.withLock(id, async () => {
      await this.refresh(s);
      if (s.status === 'awaiting_payment') return this.authorize(s, `mock_pi_${s.id}`);
      if (s.status === 'cancelled' || s.status === 'failed') {
        throw conflict('invalid_state', 'Cette session est annulée ou en échec.');
      }
      return s;
    });
  }

  async handleWebhook(event: WebhookEvent): Promise<void> {
    if (event.kind === 'ignored') return;
    const s = (event.sessionId ? this.find(event.sessionId) : undefined) ?? this.d.store.findByCheckoutId(event.checkoutId);
    if (!s || s.checkoutId !== event.checkoutId) {
      this.d.log.warn({ checkoutId: event.checkoutId }, 'webhook pour une session inconnue');
      return;
    }
    await this.withLock(s.id, async () => {
      if (event.kind === 'checkout_completed') {
        if (event.paymentRef) await this.authorize(s, event.paymentRef);
      } else if (s.status === 'awaiting_payment') {
        this.markCancelled(s, 'checkout_expired', 'La page de paiement a expiré.');
      }
    });
  }

  async stop(id: string): Promise<SessionRecord> {
    const s = this.require(id);
    return this.withLock(id, async () => {
      await this.refresh(s);
      if (s.status === 'charging' || s.status === 'starting') return this.finish(s);
      if (s.status === 'completed') return s; // idempotent (refresh a relancé la capture si besoin)
      if (s.status === 'awaiting_payment') {
        throw conflict('invalid_state', 'La recharge n’a pas démarré : utilisez l’annulation.');
      }
      throw conflict('invalid_state', 'Cette session est déjà terminée.');
    });
  }

  private async finish(s: SessionRecord): Promise<SessionRecord> {
    const reading = await this.d.charger.stop(s.id);
    this.apply(s, reading.energyWh, 0);
    s.status = 'completed';
    s.endedAt = this.d.now();
    this.d.store.save(s);
    await this.settle(s);
    return s;
  }

  /** Capture du montant final (ou libération si 0). Rejouable : même clé d'idempotence. */
  private async settle(s: SessionRecord): Promise<void> {
    if (s.settled) return;
    if (!s.paymentRef) {
      s.settled = true;
      return;
    }
    try {
      if (s.totalCents > 0) await this.d.payment.capture(s.paymentRef, s.totalCents, s.captureKey);
      else await this.d.payment.release(s.paymentRef, `release_${s.id}`);
      s.settled = true;
      if (s.error?.code === 'settlement_pending') s.error = null;
    } catch (err) {
      this.d.log.error({ err, sessionId: s.id }, 'capture/libération impossible');
      if (s.status === 'completed') {
        s.error = { code: 'settlement_pending', message: 'Le débit final est en cours de traitement.' };
      }
    }
    this.d.store.save(s);
  }

  async cancel(id: string): Promise<SessionRecord> {
    const s = this.require(id);
    return this.withLock(id, async () => {
      await this.refresh(s);
      if (s.status === 'cancelled') return s;
      if (s.status === 'charging') {
        throw conflict('invalid_state', 'La recharge a démarré : utilisez l’arrêt.');
      }
      if (s.status !== 'awaiting_payment' && s.status !== 'starting') {
        throw conflict('invalid_state', 'Cette session est déjà terminée.');
      }
      try {
        if (s.paymentRef) await this.d.payment.release(s.paymentRef, `release_${s.id}`);
        else if (s.checkoutId) await this.d.payment.cancelCheckout(s.checkoutId, `release_${s.id}`);
      } catch (err) {
        this.d.log.error({ err, sessionId: s.id }, 'annulation du paiement impossible');
        throw new AppError(502, 'payment_unavailable', 'Annulation impossible pour le moment. Réessayez dans un instant.');
      }
      s.settled = true;
      return this.markCancelled(s, null, null);
    });
  }

  private markCancelled(s: SessionRecord, code: string | null, message: string | null): SessionRecord {
    s.status = 'cancelled';
    s.endedAt = this.d.now();
    s.powerKw = 0;
    s.totalCents = 0;
    s.error = code && message ? { code, message } : null;
    this.d.store.save(s);
    return s;
  }
}
