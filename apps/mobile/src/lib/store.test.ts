import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { failWrites } from '../../test/async-storage';
import { estimatedEndAt, settleStale, STALE_STARTED_MS } from './autoEnd';
import { estimateCharge } from './estimate';
import { clearHistory, loadHistory, methodLabel, totals, type ChargeRecord } from './history';
import type { Station } from './stations';
import { CONTEXT_TTL_MS, store, type ChargePlan, type DirectCharge } from './store';
import { planTariff } from './tariff';

const tick = () => new Promise((r) => setTimeout(r, 0));
const H = 3600_000;
const station = { id: 'FRTSTP0001', n: 'Borne de test', o: 'Opérateur Test', ok: 'test', lat: 48.7585, lon: 2.3035, p: 2, kw: 22, c: ['t2'], pay: ['qr_dynamique'] } as unknown as Station;
const plan: ChargePlan = { stationId: 'FRTSTP0001', pdcId: 'FR*TST*E0002', pointKw: 22, plugs: ['t2'], method: 'scan', socPercent: 20, vehicle: null, tariffRaw: '0,49 €/kWh' };

beforeEach(async () => {
  failWrites(false);
  store.setCurrent(null);
  store.setPlan(null);
  store.setDirect(null);
  await tick();
  store._resetMemory();
  await clearHistory();
});
afterEach(() => failWrites(false));

describe('borne et plan persistés (page rechargée)', () => {
  it('relus après un rechargement, sans écraser un choix déjà en mémoire', async () => {
    store.setCurrent(station);
    store.setPlan(plan);
    await tick();
    store._resetMemory();
    expect(store.current()).toBeNull();
    expect(store.plan()).toBeNull();
    const ctx = await store.hydrate();
    expect(ctx.current?.id).toBe('FRTSTP0001');
    expect(ctx.plan).toMatchObject({ stationId: 'FRTSTP0001', pdcId: 'FR*TST*E0002' });
    expect(store.plan()?.pdcId).toBe('FR*TST*E0002');
  });
  it('plan effacé (reçu enregistré, réinitialisation) : rien n’est relu', async () => {
    store.setCurrent(station);
    store.setPlan(plan);
    store.setPlan(null);
    store.setCurrent(null);
    await tick();
    store._resetMemory();
    expect(await store.hydrate()).toEqual({ current: null, plan: null });
  });
  it(`contexte de plus de ${CONTEXT_TTL_MS / H} h : ignoré`, async () => {
    const AS = (await import('@react-native-async-storage/async-storage')).default;
    await AS.setItem('branche.context.v1', JSON.stringify({ at: Date.now() - CONTEXT_TTL_MS - 1, current: station, plan }));
    store._resetMemory();
    expect(await store.hydrate()).toEqual({ current: null, plan: null });
  });
});

const started = (ago: number, extra: Partial<DirectCharge> = {}): DirectCharge => ({
  station: { id: 'FRTSTP0001', name: 'Borne de test', ok: 'test', lat: 48.7585, lon: 2.3035 },
  operatorName: 'Opérateur Test',
  url: 'http://localhost:8090/pay',
  openedAt: Date.now() - ago - 60_000,
  chargeStartedAt: Date.now() - ago,
  endedAt: null,
  plan,
  ...extra,
});

describe('recharge démarrée jamais terminée depuis plus de 24 h', () => {
  it('fin estimée à l’heure d’atteinte de 80 % sans position connue', () => {
    const d = started(30 * H);
    const minutes = estimateCharge({ vehicle: null, socPercent: 20, pointKw: 22, plugs: ['t2'], tariff: planTariff(plan) }).minutes;
    expect(estimatedEndAt(d)).toBe(d.chargeStartedAt! + minutes * 60_000);
  });
  it('fin estimée au dernier instant vu à la borne', () => {
    const d = started(30 * H);
    expect(estimatedEndAt({ ...d, lastNearAt: d.chargeStartedAt! + 50 * 60_000 })).toBe(d.chargeStartedAt! + 50 * 60_000);
  });
  it('terminée automatiquement et archivée avec son reçu à l’ouverture (jamais effacée en silence)', async () => {
    const d = started(30 * H, { lastNearAt: Date.now() - 30 * H + 45 * 60_000 });
    store.setDirect(d);
    await tick();
    store._resetMemory();
    const out = await store.loadDirect();
    expect(out).toMatchObject({ endedAt: d.lastNearAt, autoEnded: true, autoReason: 'stale' });
    expect(out?.saveFailed).toBeUndefined();
    const h = await loadHistory();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: `${d.chargeStartedAt}-FRTSTP0001`, endedAt: d.lastNearAt, kWhEstimated: true, method: 'scan' });
  });
  it('close d’office : encore affichée à la réouverture suivante (24 h comptées depuis la clôture)', async () => {
    store.setDirect(started(30 * H));
    await tick();
    store._resetMemory();
    expect(await store.loadDirect()).toMatchObject({ autoReason: 'stale' });
    await tick();
    store._resetMemory();
    const again = await store.loadDirect();
    expect(again).toMatchObject({ autoEnded: true, autoReason: 'stale' });
    expect(await settleStale(again!, again!.autoEndedAt! + STALE_STARTED_MS + 1)).toBeNull();
    expect(await loadHistory()).toHaveLength(1);
  });
  it('moins de 24 h : inchangée', async () => {
    const d = started(STALE_STARTED_MS - H);
    expect(await settleStale(d)).toBe(d);
  });
  it('historique plein : recharge gardée, signalée (saveFailed)', async () => {
    failWrites(true);
    const out = await settleStale(started(30 * H));
    expect(out).toMatchObject({ autoEnded: true, saveFailed: true });
  });
  it('terminée depuis plus de 24 h sans reçu : archivée puis retirée ; reçu déjà archivé : pas de doublon', async () => {
    const d = started(60 * H, { endedAt: Date.now() - 50 * H });
    expect(await settleStale(d)).toBeNull();
    expect(await loadHistory()).toHaveLength(1);
    expect(await settleStale(d)).toBeNull();
    expect(await loadHistory()).toHaveLength(1);
  });
  it('terminée, historique plein : gardée (saveFailed), jamais retirée', async () => {
    failWrites(true);
    expect(await settleStale(started(60 * H, { endedAt: Date.now() - 50 * H }))).toMatchObject({ saveFailed: true });
  });
});

describe('historique : méthode « lien non vérifié » et prix moyen', () => {
  it('libellé distinct', () => {
    expect(methodLabel('unverified')).toBe('Lien non vérifié, confirmé par vous');
    expect(methodLabel('unverified')).not.toBe(methodLabel('scan'));
  });
  it('la méthode réelle du paiement (DirectCharge.method) l’emporte sur celle du plan', async () => {
    const { recordOf } = await import('./autoEnd');
    expect(recordOf(started(H, { method: 'unverified' }), Date.now()).method).toBe('unverified');
    expect(recordOf(started(H), Date.now()).method).toBe('scan');
  });
  it('montant 0 € exclu du prix moyen au kWh', () => {
    const r = (id: string, pricePaid: number, kWh: number): ChargeRecord => ({
      id, startedAt: 1, endedAt: 2, stationId: 's', stationName: 's', operatorName: 'o', method: 'reader', kWh, kWhEstimated: false, pricePaid, estimatedCost: null, ok: true,
    });
    const t = totals([r('a', 10, 20), r('b', 0, 30)]);
    expect(t.avgPerKwh).toBe(0.5);
    expect(t.paidCount).toBe(2);
  });
});
