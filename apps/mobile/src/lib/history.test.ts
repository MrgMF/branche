import { beforeEach, describe, expect, it } from 'vitest';
import { addRecord, clearHistory, csvCell, loadHistory, monthStats, removeRecord, toCsv, totals, updateRecord, type ChargeRecord } from './history';
import { loadTicket, saveTicket } from './ticket';

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

describe('export CSV — injection de formules', () => {
  it('neutralise les cellules commençant par = + - @ (apostrophe), nombres intacts', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")', ';')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csvCell('+33 1 23', ';')).toBe("'+33 1 23");
    expect(csvCell('-2+3', ';')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)', ';')).toBe("'@SUM(A1)");
    expect(csvCell('  =1+1', ';')).toBe("'  =1+1");
    expect(csvCell('\tcmd', ';')).toBe("'\tcmd");
    expect(csvCell('Borne A', ';')).toBe('Borne A');
    expect(csvCell(-1.5, ';')).toBe('-1,5');
  });
  it('un nom de station piégé est neutralisé dans le fichier', () => {
    const csv = toCsv([rec({ stationName: '=cmd|"/c calc"!A1', operatorName: '@op' })]);
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
    expect(csv).toContain(";'@op;");
    expect(csv).not.toMatch(/;=|;@|;\+/);
  });
});

describe('photo du ticket (locale)', () => {
  it('stockée sur l’appareil, liée à la recharge, supprimée avec elle', async () => {
    await addRecord(rec({ id: 't1' }));
    expect(await saveTicket('t1', 'data:image/jpeg;base64,AAAA')).toBe(true);
    await updateRecord('t1', { ticket: true });
    expect((await loadHistory())[0].ticket).toBe(true);
    expect(await loadTicket('t1')).toBe('data:image/jpeg;base64,AAAA');
    await removeRecord('t1');
    expect(await loadTicket('t1')).toBeNull();
  });
  it('refuse ce qui n’est pas une image ou trop lourd', async () => {
    expect(await saveTicket('x', 'javascript:alert(1)')).toBe(false);
    expect(await saveTicket('x', `data:image/jpeg;base64,${'A'.repeat(1_000_000)}`)).toBe(false);
  });
  it('« Tout supprimer » efface aussi les photos', async () => {
    await addRecord(rec({ id: 't2' }));
    await saveTicket('t2', 'data:image/jpeg;base64,BBBB');
    await updateRecord('t2', { ticket: true });
    await clearHistory();
    expect(await loadTicket('t2')).toBeNull();
  });
});
