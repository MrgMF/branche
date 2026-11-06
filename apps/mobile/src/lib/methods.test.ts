import { describe, expect, it } from 'vitest';
import type { Wallet } from './accounts';
import { pointsOf } from './evse';
import { appOnly, badgeNames, nearestPayable, payOptions, surelyPayable } from './methods';
// Données réelles du dépôt : mêmes portails que ceux publiés par le pipeline
import realPortals from '../../../../pipeline/data/operator-portals.json';
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

describe('payOptions — portails réels (pipeline/data/operator-portals.json)', () => {
  const real: Portals = {
    izivia: { name: 'IZIVIA', webPortal: 'https://client.izivia.com/account/', webStart: { status: 'yes', url: 'https://paynow.izivia.com/' }, adhocWeb: 'https://paynow.izivia.com/' },
    freshmile: { name: 'Freshmile', webPortal: 'https://charge.freshmile.com/login', adhocWeb: 'https://xfm.fr/{code} (lien court imprimé sur l’autocollant de la borne) ou QR code -> autorisation CB' },
  };
  const iz: Station = { ...base, ok: 'izivia', pay: ['badge'], pdc: [['FR*IZI*E00123', 22, ['t2']]] };
  it('page de paiement sans gabarit {evse} : lien sans compte proposé, identifiant du point à copier', () => {
    const o = payOptions(iz, pt(iz), ops, { portals: real });
    expect(o.map((x) => x.id).slice(0, 2)).toEqual(['scan', 'operator-link']);
    expect(o[1]).toMatchObject({ url: 'https://paynow.izivia.com/', copyId: 'FR*IZI*E00123' });
    expect(o.find((x) => x.id === 'account')).toBeUndefined(); // une voie sans compte existe
  });
  it('texte descriptif (pas une URL) : paiement ponctuel reconnu, aucun lien forgé', () => {
    const fm: Station = { ...base, ok: 'freshmile', pay: ['badge'] };
    const o = payOptions(fm, pt(fm), ops, { portals: real });
    expect(o[0].id).toBe('scan');
    expect(o.find((x) => x.id === 'operator-link')!.available).toBe(false);
  });
});

describe('payOptions — opérateurs « appli seule » (Lidl, Sorégies, Seolis)', () => {
  const P = (realPortals as { operators: Portals }).operators;
  const regOps: Operator[] = [
    { key: 'lidl', names: ['Lidl France'], domains: ['lidl.fr'], payUrl: null },
    { key: 'soregies-mobilites', names: ['Sorégies Mobilités'], domains: ['soregies.fr'], payUrl: null },
    { key: 'seolis', names: ['Seolis'], domains: ['seolis.net'], payUrl: null },
  ];
  const st = (ok: string, pay: Station['pay']): Station => ({ ...base, ok, pay, pdc: [['FRLIDE0001', 22, ['t2']]] });
  const empty: Wallet = { accounts: [], badges: [] };
  it.each([
    ['lidl', ['acte']],
    ['lidl', ['acte', 'cb']],
    ['soregies-mobilites', ['acte', 'badge', 'cb']],
    ['seolis', ['acte', 'badge']],
  ] as [string, Station['pay']][])('%s %j : ni QR « paiement ponctuel » sur la foi de acte, ni compte, rien de payable', (ok, pay) => {
    const s = st(ok, pay);
    const o = payOptions(s, pt(s), regOps, { portals: P, wallet: empty });
    expect(appOnly(o)).toBe(true);
    expect(o.find((x) => x.id === 'account')).toBeUndefined(); // webPortal seul (evc-net) : pas de repli
    expect(o.find((x) => x.id === 'scan')!.why).not.toContain('déclaré par l’opérateur');
  });
  it('compte proposé seulement si webStartUrl() renvoie une URL (portail de connexion seul : non)', () => {
    const s = { ...base, pay: ['badge'] as Station['pay'] };
    const loginOnly: Portals = { test: { name: 'Opérateur Test', webPortal: 'https://compte.test/', webStart: { status: 'no', url: null } } };
    expect(payOptions(s, pt(s), ops, { portals: loginOnly }).find((x) => x.id === 'account')).toBeUndefined();
  });
  it('borne payable la plus proche : saute les stations « appli seule » et les QR seulement éventuels', () => {
    const lidl = st('lidl', ['acte']);
    const maybe: Station = { ...base, id: 'M', ok: 'test', pay: [] }; // QR éventuel, rien de déclaré
    const reader: Station = { ...base, id: 'R', ok: 'test', pay: ['cb'] };
    expect(surelyPayable(payOptions(maybe, null, ops, {}))).toBe(false);
    const sorted = [lidl, maybe, reader].map((s, i) => ({ s, d: i }));
    expect(nearestPayable(sorted, [...ops, ...regOps], { portals: P, wallet: empty })?.s.id).toBe('R');
  });
  it('badges affichés sans appli tierce', () => {
    expect(badgeNames(P.yes55.roamingBadgesAccepted)).toEqual(['Alizé Pro', 'Chargemap Pass', 'Freshmile', 'Ionity', 'Zunder', 'Ze-Watt']);
    expect(badgeNames(P['electric-55-charging'].roamingBadgesAccepted)).not.toContain('Plugsurfing (appli)');
  });
});

describe('rangs : acte seul après un lecteur CB déclaré', () => {
  it('acte + cb : lecteur d’abord, puis QR', () => {
    const s = { ...base, pay: ['acte', 'cb'] as Station['pay'] };
    expect(ids(s)).toEqual(['reader', 'scan']);
  });
  it('qr_dynamique + cb : paiement ponctuel web d’abord', () => {
    const s = { ...base, pay: ['qr_dynamique', 'cb'] as Station['pay'] };
    expect(ids(s)).toEqual(['scan', 'reader']);
  });
  it('acte + cb + adhocWeb sourcé : paiement ponctuel d’abord', () => {
    const s = { ...base, pay: ['acte', 'cb'] as Station['pay'] };
    expect(ids(s, { portals: { test: { name: 'Opérateur Test', adhocWeb: 'QR code -> page CB' } } })).toEqual(['scan', 'reader']);
  });
  it('aucun texte ne promet Apple Pay / Google Pay', () => {
    const s = { ...base, kw: 150, c: ['ccs'] as Station['c'], pay: ['qr_dynamique'] as Station['pay'], pdc: [['FRTSTE0002', 150, ['ccs']]] as Station['pdc'] };
    for (const o of payOptions(s, pt(s), ops)) expect(JSON.stringify(o)).not.toMatch(/Apple Pay|Google Pay/);
  });
});

describe('lecteur CB obligatoire en 2027', () => {
  it('mention seulement à partir de 50 kW', async () => {
    const { reader2027Applies } = await import('./methods');
    expect(reader2027Applies(22)).toBe(false);
    expect(reader2027Applies(49.9)).toBe(false);
    expect(reader2027Applies(50)).toBe(true);
    expect(reader2027Applies(150)).toBe(true);
  });
});

describe('pré-autorisation publiée (preauthMax)', () => {
  it('seulement quand sourcée (alizé, Révéo : 75 €), sinon texte générique', async () => {
    const { preauthMaxOf } = await import('./portals');
    const P = (realPortals as { operators: Portals }).operators;
    expect(preauthMaxOf(P['bouygues-energies-services'])).toBe(75);
    expect(preauthMaxOf(P['reveo-syaden'])).toBe(75);
    expect(preauthMaxOf(P.izivia)).toBeNull();
    expect(preauthMaxOf(undefined)).toBeNull();
  });
});
