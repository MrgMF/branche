import { describe, expect, it } from 'vitest';
import type { Wallet } from './accounts';
import { pointsOf } from './evse';
import { appOnly, badgeMentioned, badgeNames, nearestPayable, payOptions, sourceHosts, surelyPayable } from './methods';
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

describe('lecteur CB : IRVE (borne) ou recherche opérateur (« certains sites »), motif sourcé exact', () => {
  const P = (realPortals as { operators: Portals }).operators;
  const regOps: Operator[] = [
    { key: 'tesla', names: ['Tesla'], domains: ['tesla.com'], payUrl: null },
    { key: 'totalenergies-marketing', names: ['TotalEnergies'], domains: ['totalenergies.com'], payUrl: null },
  ];
  const empty: Wallet = { accounts: [], badges: [] };
  const tesla: Station = { ...base, id: 'FRTSLP5147', ok: 'tesla', kw: 250, c: ['ccs'], pay: ['acte', 'badge'], pdc: [['FRTSLE0004FJ', 250, ['ccs']]] };
  const total: Station = { ...base, id: 'FRHPCPNF080017', ok: 'totalenergies-marketing', kw: 300, c: ['ccs', 't2', 'chademo'], pay: ['badge'], free: true, pdc: [['FRHPCENF080017001', 300, ['ccs', 't2', 'chademo']]] };

  it('lecteur déclaré dans l’IRVE pour la borne : motif « base nationale IRVE », confirmé', () => {
    const s = { ...base, pay: ['cb'] as Station['pay'] };
    const r = payOptions(s, pt(s), ops).find((o) => o.id === 'reader')!;
    expect(r).toMatchObject({ available: true, label: 'Carte bancaire sur la borne' });
    expect(r.speculative).toBeUndefined();
    expect(r.why).toContain('déclaré pour cette borne dans la base nationale IRVE');
  });
  it('TotalEnergies 300 kW (cardReader opérateur) : « possible sur certains sites », sources citées, jamais en tête', () => {
    const o = payOptions(total, pt(total), regOps, { portals: P, wallet: empty });
    const r = o.find((x) => x.id === 'reader')!;
    expect(r.label).toBe('Carte bancaire sur la borne (possible sur certains sites)');
    expect(r.speculative).toBe(true);
    expect(r.why).toContain('sur certains sites seulement (recherche Branché : services.totalenergies.fr, largus.fr)');
    expect(r.why).toContain('non déclaré pour cette borne dans la base IRVE');
    expect(o[0].id).toBe('scan'); // QR → page CB sourcée, recommandé
    expect(o[0].speculative).toBeUndefined();
    expect(o.findIndex((x) => x.id === 'reader')).toBeGreaterThan(0);
  });
  it('un lecteur « certains sites » seul ne rend pas la borne payable (nearestPayable)', () => {
    const only: Portals = { test: { name: 'Opérateur Test', cardReader: true } };
    const s = { ...base, pay: [] as Station['pay'] };
    const o = payOptions(s, pt(s), ops, { portals: only });
    expect(o.find((x) => x.id === 'reader')).toMatchObject({ available: true, speculative: true });
    expect(surelyPayable(o)).toBe(false);
  });
  it('Tesla (appli seule, source Tesla) : ni QR sur la foi de `acte`, ni lecteur « certains sites » proposé → rien de payable', () => {
    const o = payOptions(tesla, pt(tesla), regOps, { portals: P, wallet: empty });
    expect(appOnly(o)).toBe(true);
    const scan = o.find((x) => x.id === 'scan')!;
    expect(scan.available).toBe(false);
    expect(scan.why).not.toContain('déclaré par l’opérateur');
    const r = o.find((x) => x.id === 'reader')!;
    expect(r).toMatchObject({ available: false, label: 'Carte bancaire sur la borne (possible sur certains sites)' });
    expect(r.why).toContain('recherche Branché : tesla.com, tesla-mag.com, blog.chargemap.com');
    expect(o.find((x) => x.id === 'account')).toBeUndefined();
    // Borne payable la plus proche : saute le Superchargeur
    const reader: Station = { ...base, id: 'R', pay: ['cb'] };
    expect(nearestPayable([tesla, reader].map((s, i) => ({ s, d: i })), [...ops, ...regOps], { portals: P, wallet: empty })?.s.id).toBe('R');
  });
  it('Tesla avec un Chargemap Pass (badge accepté selon les sources) : badge proposé', () => {
    const o = payOptions(tesla, pt(tesla), regOps, { portals: P, wallet: { accounts: [], badges: ['Chargemap Pass'] } });
    expect(o[0]).toMatchObject({ id: 'badge', available: true });
  });
  it('étapes du lecteur : écran ou étiquette selon la borne (point connu / inconnu)', () => {
    const s = { ...base, pay: ['cb'] as Station['pay'] };
    const ac = payOptions(s, pt(s), ops).find((o) => o.id === 'reader')!;
    expect(ac.steps[0]).toBe('Repérez le point …⁠0001 sur l’étiquette de la prise ; si la borne a un écran, choisissez-le puis « Paiement par carte ».');
    const none = payOptions(s, null, ops).find((o) => o.id === 'reader')!;
    expect(none.steps[0]).toContain('Si la borne a un écran');
    expect(none.steps[0]).toContain('étiquette');
  });
});

describe('badge mentionné seulement si l’IRVE le déclare (ou badge de l’utilisateur accepté selon les sources)', () => {
  it('pay sans badge : aucune option badge', () => {
    const s = { ...base, pay: ['cb'] as Station['pay'] };
    expect(payOptions(s, pt(s), ops).map((o) => o.id)).not.toContain('badge');
    expect(badgeMentioned(s)).toBe(false);
  });
  it('pay avec badge : option badge (indisponible sans badge enregistré)', () => {
    const s = { ...base, pay: ['cb', 'badge'] as Station['pay'] };
    expect(payOptions(s, pt(s), ops).find((o) => o.id === 'badge')).toMatchObject({ available: false });
    expect(badgeMentioned(s)).toBe(true);
  });
  it('texte « Pas de paiement possible » : badges cités seulement si la borne en déclare', async () => {
    const { tr } = await import('../i18n');
    expect(tr().recharger.blockedBody('Lidl', 'Chargemap Pass', false)).not.toMatch(/badge/i);
    expect(tr().recharger.blockedBody('Lidl', 'Chargemap Pass', true)).toContain('badges acceptés : Chargemap Pass');
    expect(tr().recharger.blockedBody('Lidl', null, true)).toContain('« Mes badges »');
  });
});

describe('lien de secours sans QR : page de démarrage sourcée (webStart https) + identifiant à copier', () => {
  const P = (realPortals as { operators: Portals }).operators;
  it.each([
    ['virta', 'https://chge.eu', 'FRVIRE269470'],
    ['engie-vianeo', 'https://charge.engie-vianeo.com/', 'FRVIAE12345955331'],
    ['qwello', 'https://wa.qwello.eu/', 'FRQWEE0001'],
    ['ionity', 'https://payment.ionity.eu', 'FRIONE0001'],
  ])('%s → %s, identifiant %s à copier', (ok, url, id) => {
    const s: Station = { ...base, ok, kw: 150, c: ['ccs'], pay: [], pdc: [[id, 150, ['ccs']]] };
    const link = payOptions(s, pt(s), ops, { portals: P }).find((o) => o.id === 'operator-link')!;
    expect(link).toMatchObject({ available: true, url, copyId: id });
  });
  it('jamais en http (Electric 55 : map.e55c.com publié en http) ni chez un opérateur « appli seule »', () => {
    const e55: Station = { ...base, ok: 'electric-55-charging', pay: [] };
    expect(payOptions(e55, pt(e55), ops, { portals: P }).find((o) => o.id === 'operator-link')!.available).toBe(false);
    const appOnlyStart: Portals = { test: { name: 'Opérateur Test', appOnly: true, adhocWeb: 'x', webStart: { status: 'yes', url: 'https://start.test/' } } };
    expect(payOptions(base, pt(base), ops, { portals: appOnlyStart }).find((o) => o.id === 'operator-link')!.available).toBe(false);
  });
  it('sourceHosts : domaines exacts des sources, sans www', () => {
    expect(sourceHosts(['https://www.tesla.com/a', 'https://www.tesla.com/b', 'https://blog.chargemap.com/?p=1'])).toBe('tesla.com, blog.chargemap.com');
    expect(sourceHosts([])).toBeNull();
  });
});
