import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => push(...a) } }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn(async () => ({ type: 'dismiss' })), WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' } }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { clearWallet, loadWallet } from './accounts';
import { runPlan } from './connectors';
import { store, type ChargePlan } from './store';
import type { Station } from './stations';

const st: Station = { id: 'S1', n: 'Borne', lat: 48, lon: 2, p: 1, kw: 22, c: ['t2'], pay: ['badge'], ok: 'test', pdc: [['FRTSTE0001', 22, ['t2']]] };
const plan = (method: ChargePlan['method']): ChargePlan => ({ stationId: 'S1', pdcId: 'FRTSTE0001', pointKw: 22, plugs: ['t2'], method, socPercent: null, vehicle: null });

beforeEach(async () => {
  push.mockClear();
  store.setDirect(null);
  await clearWallet();
});

describe('runPlan — compte opérateur', () => {
  it('n’est jamais marqué « connecté » à l’ouverture du site ; la question est posée au retour', async () => {
    runPlan(st, plan('account'), 'Opérateur Test', 'https://compte.test/start');
    await new Promise((r) => setTimeout(r, 0));
    expect((await loadWallet()).accounts).toEqual([]);
    expect(store.direct()?.accountAsk).toEqual({ key: 'test', name: 'Opérateur Test' });
    expect(push).toHaveBeenCalledWith('/recharge');
  });
  it('lien de paiement sans compte : aucune question de compte', async () => {
    runPlan(st, plan('operator-link'), 'Opérateur Test', 'https://pay.test/');
    await new Promise((r) => setTimeout(r, 0));
    expect(store.direct()?.accountAsk).toBeUndefined();
  });
});
