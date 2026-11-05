import { describe, expect, it } from 'vitest';
import { pointsOf } from './evse';
import { payOptions } from './methods';
import type { Operator } from './qr';
import type { Station } from './stations';

const ops: Operator[] = [{ key: 'test', names: ['Opérateur Test'], domains: ['localhost:8090'], payUrl: null }];
const base: Station = { id: 'S', n: 'S', lat: 48, lon: 2, p: 1, kw: 22, c: ['t2'], pay: [], ok: 'test', pdc: [['FRTSTE0001', 22, ['t2']]] };

describe('payOptions (méthode recommandée classée)', () => {
  it('lecteur CB en premier quand l’IRVE l’indique ; Carte Branché toujours désactivée et en dernier', () => {
    const s = { ...base, pay: ['cb', 'sans_contact', 'qr_dynamique'] as Station['pay'] };
    const o = payOptions(s, pointsOf(s)[0], ops);
    expect(o.map((x) => x.id)).toEqual(['reader', 'scan', 'operator-link', 'branche-card']);
    expect(o[0].available).toBe(true);
    expect(o[0].label).toContain('sans contact');
    expect(o.at(-1)).toMatchObject({ id: 'branche-card', available: false });
    expect(o.at(-1)!.why).toContain('pas encore signé');
  });
  it('sans lecteur : QR vérifié recommandé ; AC = payer d’abord, puis brancher son câble sur …0001', () => {
    const o = payOptions({ ...base, pay: ['qr_dynamique'] }, pointsOf(base)[0], ops);
    expect(o[0].id).toBe('scan');
    expect(o[0].order).toBe('pay-first');
    expect(o[0].steps[0]).toBe('Scannez le QR code près du point …0001 : Branché vérifie l’adresse.');
    expect(o[0].steps[2]).toContain('votre câble Type 2');
    expect(o.find((x) => x.id === 'reader')!.available).toBe(false);
  });
  it('DC : brancher d’abord le câble CCS de la borne', () => {
    const s: Station = { ...base, kw: 150, c: ['ccs'], pay: ['cb'], pdc: [['FRTSTE0002', 150, ['ccs']]] };
    const o = payOptions(s, pointsOf(s)[0], ops);
    expect(o[0]).toMatchObject({ id: 'reader', order: 'plug-first' });
    expect(o[0].steps[0]).toBe('Branchez le câble CCS Combo de la borne sur votre voiture.');
  });
  it('lien opérateur seulement avec un gabarit vérifié', () => {
    const withUrl = [{ ...ops[0], payUrl: 'https://pay.test/{evse}' }];
    const o = payOptions(base, pointsOf(base)[0], withUrl);
    expect(o.find((x) => x.id === 'operator-link')).toMatchObject({ available: true, url: 'https://pay.test/FRTSTE0001' });
  });
});
