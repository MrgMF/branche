import { describe, expect, it } from 'vitest';
import { evseInText, qrTarget } from './qrTarget';
import type { Station } from './stations';

const st: Station = {
  id: 'FRTSTP0001', n: 'Borne de test', lat: 48.7585, lon: 2.3035, p: 2, kw: 22, c: ['t2'], pay: ['qr_dynamique'], ok: 'test',
  pdc: [['FR*TST*E0001', 22, ['t2']], ['FR*TST*E0002', 22, ['t2']]],
};
const other: Station = { ...st, id: 'FRAAAP0009', n: 'Autre borne', pdc: [['FR*AAA*E0009', 50, ['ccs']]] };

describe('evseInText', () => {
  it('lit l’identifiant dans un lien ou un texte', () => {
    expect(evseInText('http://localhost:8090/pay?evse=FR*TST*E0002')).toBe('FRTSTE0002');
    expect(evseInText('https://x.fr/pay?evse=FR%2ATST%2AE0001')).toBe('FRTSTE0001');
    expect(evseInText('https://chge.eu/')).toBeNull();
  });
});

describe('qrTarget — jamais de bascule silencieuse', () => {
  it('même point : rien à confirmer', () => {
    expect(qrTarget(st, 'FR*TST*E0001', 'FRTSTE0001', null)).toMatchObject({ kind: 'same', point: { short: '0001' } });
  });
  it('autre point de la même borne : confirmation « …0002 »', () => {
    const r = qrTarget(st, 'FR*TST*E0001', 'FRTSTE0002', null);
    expect(r.kind).toBe('point');
    if (r.kind === 'point') {
      expect(r.point.short).toBe('0002');
      expect(r.chosen.short).toBe('0001');
    }
  });
  it('borne choisie sans point encore fixé : le point du QR est retenu', () => {
    expect(qrTarget(st, null, 'FRTSTE0002', null)).toMatchObject({ kind: 'same', point: { short: '0002' } });
  });
  it('autre borne : confirmation nommant la borne', () => {
    expect(qrTarget(st, 'FR*TST*E0001', 'FRAAAE0009', { station: other, pdcId: 'FRAAAE0009' })).toMatchObject({ kind: 'station', station: { n: 'Autre borne' } });
  });
  it('scan depuis l’accueil (aucune borne choisie) : borne du QR retenue', () => {
    expect(qrTarget(null, null, 'FRAAAE0009', { station: other, pdcId: 'FRAAAE0009' }).kind).toBe('select');
  });
  it('identifiant inconnu ou absent', () => {
    expect(qrTarget(st, null, 'FRZZZE0001', null).kind).toBe('none');
    expect(qrTarget(st, null, null, null).kind).toBe('none');
  });
});
