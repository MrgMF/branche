import { beforeEach, describe, expect, it } from 'vitest';
import { addRecord, clearHistory, loadHistory, monthStats, removeRecord, toCsv, totals, type ChargeRecord } from './history';

const rec = (o: Partial<ChargeRecord>): ChargeRecord => ({
  id: 'r1',
  startedAt: new Date(2026, 10, 5, 14, 0).getTime(),
  endedAt: new Date(2026, 10, 5, 14, 40).getTime(),
  stationId: 'FRTSTP0001',
  stationName: 'Borne de test (CPO local)',
  operatorName: 'Opérateur Test',
  pdcId: 'FRTSTE0001',
  method: 'scan',
  kWh: 20,
  kWhEstimated: false,
  pricePaid: 9.8,
  estimatedCost: 10.1,
  ok: true,
  ...o,
});

beforeEach(() => clearHistory());

describe('historique local', () => {
  it('ajout (tri du plus récent), persistance, suppression', async () => {
    await addRecord(rec({ id: 'a' }));
    await addRecord(rec({ id: 'b', startedAt: new Date(2026, 10, 6).getTime() }));
    expect((await loadHistory()).map((r) => r.id)).toEqual(['b', 'a']);
    expect((await removeRecord('b')).map((r) => r.id)).toEqual(['a']);
    await clearHistory();
    expect(await loadHistory()).toEqual([]);
  });

  it('total du mois et prix moyen au kWh (seulement montants ET kWh connus)', () => {
    const now = new Date(2026, 10, 20).getTime();
    const list = [
      rec({ id: '1', pricePaid: 10, kWh: 20 }),
      rec({ id: '2', pricePaid: 5, kWh: null }),
      rec({ id: '3', pricePaid: null, kWh: 30 }),
      rec({ id: '4', pricePaid: 99, kWh: 10, startedAt: new Date(2026, 9, 30).getTime() }), // octobre
    ];
    const m = monthStats(list, now);
    expect(m.count).toBe(3);
    expect(m.total).toBe(15);
    expect(m.paidCount).toBe(2);
    expect(m.avgPerKwh).toBe(0.5);
    expect(m.month).toBe('novembre 2026');
    expect(totals([]).avgPerKwh).toBeNull();
  });

  it('CSV : BOM, « ; », virgule décimale, échappement des guillemets', () => {
    const csv = toCsv([rec({ stationName: 'Parking "Gare"; niveau -1', pricePaid: 12.5, kWh: 25.25 })]);
    expect(csv.startsWith('﻿Date;Fin;Station;')).toBe(true);
    const line = csv.split('\r\n')[1];
    expect(line).toContain('2026-11-05 14:00;2026-11-05 14:40;"Parking ""Gare""; niveau -1";Opérateur Test;FRTSTE0001;');
    expect(line).toContain(';25,25;non;12,5;10,1;oui;');
    expect(toCsv([]).split('\r\n')).toHaveLength(2);
  });
});
