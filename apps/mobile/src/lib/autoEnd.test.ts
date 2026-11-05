import { beforeEach, describe, expect, it } from 'vitest';
import { autoFinish, departed, recordOf } from './autoEnd';
import { clearHistory, loadHistory } from './history';
import type { DirectCharge } from './store';

const d: DirectCharge = {
  station: { id: 'FRTSTP0001', name: 'Borne de test', lat: 48.7585, lon: 2.3035 },
  operatorName: 'Opérateur Test',
  url: '',
  openedAt: Date.UTC(2026, 10, 5, 10, 0),
  chargeStartedAt: Date.UTC(2026, 10, 5, 10, 2),
  endedAt: null,
  plan: { stationId: 'FRTSTP0001', pdcId: 'FR*TST*E0001', pointKw: 22, plugs: ['t2'], method: 'reader', socPercent: 20, vehicle: null, tariffRaw: '0,49 €/kWh' },
};
const at = (lat: number, lon: number, speed: number | null = null) => ({ lat, lon, speed, at: 0 });

beforeEach(() => clearHistory());

describe('fin automatique', () => {
  it('à la borne : jamais', () => {
    expect(departed(d, at(48.7586, 2.3036, 15))).toBe(false);
  });
  it('à 300 m en roulant : oui ; à 300 m à pied sans vitesse : non ; au retour dans l’app : oui', () => {
    expect(departed(d, at(48.7612, 2.3035, 12))).toBe(true);
    expect(departed(d, at(48.7612, 2.3035, 1))).toBe(false);
    expect(departed(d, at(48.7612, 2.3035), true)).toBe(true);
  });
  it('loin (> 400 m) même sans vitesse (web)', () => {
    expect(departed(d, at(48.77, 2.3035))).toBe(true);
  });
  it('reçu immédiatement dans l’historique, fin = dernier instant vu à la borne', async () => {
    const lastNear = d.chargeStartedAt! + 40 * 60_000;
    const out = await autoFinish({ ...d, lastNearAt: lastNear }, lastNear + 10 * 60_000);
    expect(out.endedAt).toBe(lastNear);
    expect(out.autoEnded).toBe(true);
    const h = await loadHistory();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: `${d.chargeStartedAt}-FRTSTP0001`, method: 'reader', kWhEstimated: true, pricePaid: null });
    expect(h[0].kWh).toBeGreaterThan(5);
    expect(recordOf(d, lastNear).id).toBe(h[0].id);
  });
});
