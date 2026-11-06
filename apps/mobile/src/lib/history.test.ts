import { beforeEach, describe, expect, it } from 'vitest';
import AsyncStorage, { failWrites } from '../../test/async-storage';
import { addRecord, clearHistory, csvCell, HistorySaveError, loadHistory, monthStats, removeRecord, toCsv, totals, updateRecord, type ChargeRecord } from './history';
import { loadTicket, saveTicket, setTicketBlobs, ticketKey } from './ticket';
import type { TicketBlobStore } from './ticketBlob';

// Magasin d'images en mémoire (fichiers en natif, IndexedDB sur le web) ; `failPut` simule un disque plein.
const files = new Map<string, string>();
let failPut = false;
const memBlobs: TicketBlobStore = {
  put: async (id, data) => {
    if (failPut) throw new Error('ENOSPC');
    files.set(`mem:${id}`, data);
    return `mem:${id}`;
  },
  get: async (ref) => files.get(ref) ?? null,
  del: async (ref) => void files.delete(ref),
};
setTicketBlobs(memBlobs);

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

beforeEach(async () => {
  failWrites(false);
  failPut = false;
  await clearHistory();
});

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

describe('photo du ticket : fichier / IndexedDB, AsyncStorage ne garde qu’une référence', () => {
  it('l’image va dans le magasin de fichiers ; AsyncStorage ne contient que {"ref"}', async () => {
    const img = `data:image/jpeg;base64,${'Q'.repeat(5000)}`;
    expect(await saveTicket('ref1', img)).toBe(true);
    const raw = await AsyncStorage.getItem(ticketKey('ref1'));
    expect(JSON.parse(raw!)).toEqual({ ref: 'mem:ref1' });
    expect(raw!.length).toBeLessThan(40);
    expect(files.get('mem:ref1')).toBe(img);
    expect(await loadTicket('ref1')).toBe(img);
  });
  it('ancien format (data URI dans AsyncStorage) toujours lu, puis supprimé', async () => {
    await AsyncStorage.setItem(ticketKey('old'), 'data:image/jpeg;base64,OLD');
    expect(await loadTicket('old')).toBe('data:image/jpeg;base64,OLD');
    await addRecord(rec({ id: 'old', ticket: true }));
    await removeRecord('old');
    expect(await AsyncStorage.getItem(ticketKey('old'))).toBeNull();
  });
  it('fichier impossible à écrire → false (message affiché), rien d’enregistré', async () => {
    failPut = true;
    expect(await saveTicket('full', 'data:image/jpeg;base64,AAAA')).toBe(false);
    expect(await AsyncStorage.getItem(ticketKey('full'))).toBeNull();
  });
  it('référence impossible à écrire → false, et pas d’image orpheline', async () => {
    failWrites(true);
    expect(await saveTicket('orph', 'data:image/jpeg;base64,AAAA')).toBe(false);
    failWrites(false);
    expect(files.has('mem:orph')).toBe(false);
  });
});

describe('historique : toute erreur d’écriture remonte (affichée par l’écran)', () => {
  it('addRecord / updateRecord / removeRecord / clearHistory lèvent HistorySaveError, liste inchangée', async () => {
    await addRecord(rec({ id: 'keep' }));
    failWrites(true);
    await expect(addRecord(rec({ id: 'lost' }))).rejects.toBeInstanceOf(HistorySaveError);
    await expect(updateRecord('keep', { pricePaid: 1 })).rejects.toBeInstanceOf(HistorySaveError);
    await expect(removeRecord('keep')).rejects.toBeInstanceOf(HistorySaveError);
    await expect(clearHistory()).rejects.toBeInstanceOf(HistorySaveError);
    failWrites(false);
    const list = await loadHistory();
    expect(list.map((r) => r.id)).toEqual(['keep']);
    expect(list[0].pricePaid).toBe(9.8);
  });
});
