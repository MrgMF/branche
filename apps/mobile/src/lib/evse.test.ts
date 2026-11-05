import { describe, expect, it } from 'vitest';
import { evseBucket, normId, pointById, pointsOf, shortId } from './evse';
import type { Station } from './stations';

describe('index EVSE (même calcul que le pipeline)', () => {
  it('vecteurs partagés avec pipeline/test/normalize.test.mjs', () => {
    expect(evseBucket('FRTSTE0001')).toBe('2c');
    expect(evseBucket('FR*TST*E0001')).toBe('2c');
    expect(evseBucket('FR*S61*E123')).toBe('56');
    expect(normId('fr*abc* e1')).toBe('FRABCE1');
  });
});

describe('points de charge', () => {
  const s: Station = {
    id: 'FRAAAP1', n: 'Gare', lat: 48, lon: 2, p: 3, kw: 150, c: ['ccs', 't2'], pay: ['cb'],
    pdc: [['FR*AAA*E1A2B', 22, ['t2']], ['FR*AAA*E9C3D', 150, ['ccs']], ['FRAAAE0007', 0]],
  };
  it('4 derniers caractères, prises par point, repli sur la station pour les anciennes tuiles', () => {
    const p = pointsOf(s);
    expect(p.map((x) => x.short)).toEqual(['1A2B', '9C3D', '0007']);
    expect(p[1].plugs).toEqual(['ccs']);
    expect(p[2]).toMatchObject({ kw: 150, plugs: ['ccs', 't2'], exact: false });
    expect(pointById(s, 'fraaae9c3d')?.kw).toBe(150);
    expect(shortId('FR*TST*E0001')).toBe('0001');
  });
  it('station sans liste de points : un point synthétique', () => {
    expect(pointsOf({ ...s, pdc: undefined })).toHaveLength(1);
  });
});
