import { describe, expect, it } from 'vitest';
import type { Wallet } from './accounts';
import { pointsOf } from './evse';
import { appOnly, payOptions } from './methods';
import type { Portals } from './portals';
import type { Operator } from './qr';
import type { Station } from './stations';

const ops: Operator[] = [{ key: 'test', names: ['Opérateur Test'], domains: ['localhost:8090'], payUrl: null }];
const base: Station = { id: 'S', n: 'S', lat: 48, lon: 2, p: 1, kw: 22, c: ['t2'], pay: [], ok: 'test', pdc: [['FRTSTE0001', 22, ['t2']]] };
const pt = (s: Station) => pointsOf(s)[0];
const ids = (s: Station, ctx = {}) => payOptions(s, pt(s), ops, ctx).filter((o) => o.available).map((o) => o.id);
const portals: Portals = {
  test: { name: 'Opérateur Test', webPortal: 'https://compte.test/', webStart: { status: 'confirmé', url: 'https://compte.test/start?evse={evse}' }, roamingBadgesAccepted: ['Chargemap Pass', 'Shell Recharge'] },
};
const connected: Wallet = { accounts: [{ operatorKey: 'test', name: 'Opérateur Test', connectedAt: 1 }], badges: ['Chargemap Pass'] };

describe('payOptions — sans compte d’abord', () => {
  it('paiement ponctuel déclaré, puis CB au lecteur ; jamais de Carte Branché', () => {
    const s = { ...base, pay: ['cb', 'sans_contact', 'qr_dynamique'] as Station['pay'] };
    expect(ids(s)).toEqual(['scan', 'reader']);
    expect(payOptions(s, pt(s), ops).map((o) => o.id)).not.toContain('branche-card' as never);
  });
  it('même avec un compte connecté, la voie sans compte passe en premier et le compte n’est pas proposé', () => {
    const s = { ...base, pay: ['cb'] as Station['pay'] };
    expect(ids(s, { portals, wallet: connected })).toEqual(['reader', 'badge', 'scan']);
  });
  it('compte imposé (ni ponctuel, ni lecteur) : « Ajouter mon compte X une fois », puis réutilisé', () => {
    const s = { ...base, pay: ['badge'] as Station['pay'] };
    const first = payOptions(s, pt(s), ops, { portals, wallet: { accounts: [], badges: [] } });
    expect(first[0]).toMatchObject({ id: 'account', label: 'Ajouter mon compte Opérateur Test une fois', url: 'https://compte.test/start?evse=FRTSTE0001' });
    const again = payOptions(s, pt(s), ops, { portals, wallet: connected });
    expect(again[0]).toMatchObject({ id: 'account', label: 'Démarrer avec mon compte Opérateur Test' });
  });
  it('badge accepté (liste de l’opérateur) proposé avant un compte à créer', () => {
    const s = { ...base, pay: ['badge'] as Station['pay'] };
    const o = payOptions(s, pt(s), ops, { portals, wallet: { accounts: [], badges: ['chargemap pass'] } });
    expect(o.map((x) => x.id).slice(0, 2)).toEqual(['badge', 'account']);
  });
  it('sans lecteur ni portail : QR vérifié ; AC = payer d’abord ; consignes adaptées au point …0001', () => {
    const o = payOptions({ ...base, pay: ['qr_dynamique'] }, pt(base), ops);
    expect(o[0].id).toBe('scan');
    expect(o[0].order).toBe('pay-first');
    expect(o[0].steps[0]).toBe('Scannez le QR code près du point …\u20600001 : Branché vérifie l’adresse.');
    expect(o[0].steps[2]).toContain('votre câble Type 2');
  });
  it('DC : brancher d’abord le câble CCS de la borne', () => {
    const s: Station = { ...base, kw: 150, c: ['ccs'], pay: ['cb'], pdc: [['FRTSTE0002', 150, ['ccs']]] };
    const o = payOptions(s, pt(s), ops);
    expect(o[0]).toMatchObject({ id: 'reader', order: 'plug-first' });
    expect(o[0].steps[0]).toBe('Branchez le câble CCS Combo de la borne sur votre voiture.');
  });
  it('lien opérateur seulement avec un gabarit vérifié', () => {
    const withUrl = [{ ...ops[0], payUrl: 'https://pay.test/{evse}' }];
    expect(payOptions(base, pt(base), withUrl).find((x) => x.id === 'operator-link')).toMatchObject({ available: true, url: 'https://pay.test/FRTSTE0001' });
  });
  it('appli seule (déclaré par le portail) : rien de payable, dit honnêtement', () => {
    const s = { ...base, pay: ['badge'] as Station['pay'] };
    const o = payOptions(s, pt(s), ops, { portals: { test: { name: 'Opérateur Test', appOnly: true } }, wallet: { accounts: [], badges: [] } });
    expect(appOnly(o)).toBe(true);
  });
});
