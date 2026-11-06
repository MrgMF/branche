import { describe, expect, it } from 'vitest';
// Portails réels (pipeline/data/operator-portals.json, URL sourcées)
import realPortals from '../../../../pipeline/data/operator-portals.json';
import { appLaunchOption, confirmedChannels, copyIdFor, payOptions, showsAccepted, surelyPayable, trackedPointEntry } from './methods';
import { acceptedOn, appLaunchTargets, appOpenUrl, appStoreUrl, idEntryOf, portalPaid, walletOnPage, type AppLaunch, type Portals } from './portals';
import type { Operator } from './qr';
import type { Station } from './stations';
import { DICTS, LANGS } from '../i18n';

const P = (realPortals as { operators: Portals }).operators;
const ID = 'FR*VIR*E269470';

describe('saisie du point sur la page ouverte (suivi de recharge = règle de payOptions)', () => {
  it('Virta : numéro inscrit sur la borne (4 à 5 chiffres), rien à copier', () => {
    const e = idEntryOf(P.virta);
    expect(e).toEqual({ entry: 'printed', digits: [4, 5] });
    expect(copyIdFor('https://chge.eu', ID, e)).toBeUndefined();
    expect(trackedPointEntry('operator-link', 'https://chge.eu', ID, e)).toEqual({ entry: 'printed', digits: [4, 5] });
  });
  it('IONITY : choix dans la liste, rien à copier', () => {
    const e = idEntryOf(P.ionity);
    expect(trackedPointEntry('operator-link', 'https://payment.ionity.eu', 'FR*ION*E1', e)).toEqual({ entry: 'select', digits: null });
  });
  it('identifiant IRVE (emi3 ou saisie non documentée) : copié, sauf s’il est déjà dans l’adresse', () => {
    const none = idEntryOf(undefined);
    expect(trackedPointEntry('operator-link', 'https://pay.example.com/', ID, none)).toEqual({ copyId: ID });
    expect(trackedPointEntry('account', 'https://pay.example.com/', ID, { entry: 'emi3', digits: null })).toEqual({ copyId: ID });
    expect(trackedPointEntry('operator-link', `https://pay.example.com/evse/${encodeURIComponent(ID)}`, ID, none)).toEqual({});
  });
  it('QR code vérifié, lien non vérifié, lecteur, badge : jamais d’identifiant à copier', () => {
    for (const m of ['scan', 'unverified', 'reader', 'badge'] as const) expect(trackedPointEntry(m, 'https://pay.example.com/', ID, idEntryOf(undefined))).toEqual({});
    expect(trackedPointEntry('operator-link', '', ID, idEntryOf(undefined))).toEqual({});
  });
});

describe('réseau payant selon ses sources (portalPaid)', () => {
  it('Electra (CB sans contact sourcée), IONITY (pré-autorisation), Virta (page de paiement) : payants', () => {
    expect(portalPaid(P.electra)).toBe(true);
    expect(portalPaid(P.ionity)).toBe(true);
    expect(portalPaid(P.virta)).toBe(true);
  });
  it('sans source https, ou sans paiement documenté : non', () => {
    expect(portalPaid(undefined)).toBe(false);
    expect(portalPaid({ name: 'X', cardReader: true, sources: [] })).toBe(false);
    expect(portalPaid({ name: 'X', cardReader: true, sources: ['test'] })).toBe(false);
    expect(portalPaid({ name: 'X', cardReader: null, adhocWeb: null, sources: ['https://x.fr/faq'] })).toBe(false);
  });
});

describe('moyens acceptés (payMethods sourcés) : seulement les valeurs true, « probable » formulé comme tel', () => {
  const ids = (k: string, ch: 'web' | 'reader') => acceptedOn(P[k], ch)?.items.map((i) => i.brand ?? i.id) ?? null;
  it('Road (E-Flux) : CB, Apple Pay, Google Pay sur la page ; lecteur sans contact, portefeuilles probables', () => {
    expect(ids('road', 'web')).toEqual(['card', 'Apple Pay', 'Google Pay']);
    expect(acceptedOn(P.road, 'reader')).toEqual({ items: [{ id: 'contactless', brand: null }], nfcProbable: true });
  });
  it('IONITY : CB seule sur la page (portefeuilles au terminal NFC seulement), Apple Pay et Google Pay au lecteur', () => {
    expect(ids('ionity', 'web')).toEqual(['card']);
    expect(ids('ionity', 'reader')).toEqual(['contactless', 'Apple Pay', 'Google Pay']);
    expect(acceptedOn(P.ionity, 'reader')?.nfcProbable).toBe(false);
  });
  it('TotalEnergies : CB sur la page, rien d’inconnu au lecteur ; Lidl (tout à false) : rien', () => {
    expect(ids('totalenergies-marketing', 'web')).toEqual(['card']);
    expect(acceptedOn(P['totalenergies-marketing'], 'reader')).toBeNull();
    expect(acceptedOn(P.lidl, 'web')).toBeNull();
    expect(acceptedOn(P.lidl, 'reader')).toBeNull();
    expect(acceptedOn(undefined, 'web')).toBeNull();
  });
  it('aucune page ne montre PayPal ; Apple Pay sur une page seulement chez Road', () => {
    for (const [k, p] of Object.entries(P)) {
      const web = acceptedOn(p, 'web')?.items.map((i) => i.id) ?? [];
      expect(web, k).not.toContain('paypal');
      if (web.includes('applePay')) expect(k).toBe('road');
    }
  });
  it('sans source https, une valeur true n’est jamais affichée ; « probable » exige un lecteur sans contact confirmé', () => {
    expect(acceptedOn({ name: 'X', payMethods: { adhoc: { card: true, applePay: true }, sources: [] } }, 'web')).toBeNull();
    expect(acceptedOn({ name: 'X', payMethods: { adhoc: { card: true }, sources: ['http://x.fr'] } }, 'web')).toBeNull();
    expect(acceptedOn({ name: 'X', payMethods: { reader: { contactless: null, nfcWallets: 'probable' }, sources: ['https://x.fr'] } }, 'reader')).toBeNull();
    expect(acceptedOn({ name: 'X', payMethods: { adhoc: { card: 'probable', applePay: 'probable' }, sources: ['https://x.fr'] } }, 'web')).toBeNull();
  });
  it('rappel du portefeuille de la page selon l’appareil : Apple Pay (iOS), Google Pay (Android), les deux (web)', () => {
    expect(walletOnPage(P.road, 'ios')).toEqual(['Apple Pay']);
    expect(walletOnPage(P.road, 'android')).toEqual(['Google Pay']);
    expect(walletOnPage(P.road, 'web')).toEqual(['Apple Pay', 'Google Pay']);
    // IONITY : portefeuilles au lecteur seulement, jamais rappelés pour la page
    for (const os of ['ios', 'android', 'web']) expect(walletOnPage(P.ionity, os)).toEqual([]);
  });
  it('carte d’une méthode disponible seulement ; fiche station : canaux déclarés (jamais QR « éventuel » ni lecteur « certains sites »)', () => {
    expect(showsAccepted({ id: 'scan', available: true })).toBe('web');
    expect(showsAccepted({ id: 'operator-link', available: true })).toBe('web');
    expect(showsAccepted({ id: 'reader', available: true })).toBe('reader');
    expect(showsAccepted({ id: 'reader', available: false })).toBeNull();
    expect(showsAccepted({ id: 'badge', available: true })).toBeNull();
    expect(showsAccepted({ id: 'account', available: true })).toBeNull();
    expect(confirmedChannels([{ id: 'reader', available: true, speculative: true } as never, { id: 'scan', available: true } as never])).toEqual({ web: true, reader: false });
  });
  it('textes traduits : noms de marque fournis par l’app, accord du pluriel', () => {
    expect(DICTS.fr.accepted.walletOnPage(1, 'Apple Pay')).toBe('Apple Pay disponible sur la page de paiement');
    expect(DICTS.fr.accepted.walletOnPage(2, 'Apple Pay et Google Pay')).toBe('Apple Pay et Google Pay disponibles sur la page de paiement');
    expect(DICTS.fr.accepted.nfcProbable).toBe('Paiement mobile sans contact probablement accepté');
    for (const l of LANGS) {
      expect(DICTS[l].accepted.walletOnPage(1, 'Google Pay'), l).toContain('Google Pay');
      expect(DICTS[l].accepted.nfcProbable, l).not.toMatch(/Apple|Google/);
    }
  });
});

describe('passerelle « Démarrer avec l’appli » (appLaunch)', () => {
  const full: AppLaunch = { scheme: 'monapp://', universal: 'https://go.op.fr/charge', evseParam: 'evse', ios: 'https://apps.apple.com/app/id1', android: 'com.op.app' };
  it('fiche de store selon l’OS (Play construit depuis le paquet, App Store sur iOS/web)', () => {
    expect(appStoreUrl(full, 'android')).toBe('https://play.google.com/store/apps/details?id=com.op.app');
    expect(appStoreUrl(full, 'ios')).toBe('https://apps.apple.com/app/id1');
    expect(appStoreUrl({ ...full, ios: null }, 'web')).toBe('https://play.google.com/store/apps/details?id=com.op.app');
    expect(appStoreUrl({ ...full, android: null }, 'android')).toBe(null);
  });
  it('lien d’ouverture : universal link prioritaire, borne ciblée si evseParam', () => {
    expect(appOpenUrl(full, 'FR*ABC*E1')).toBe('https://go.op.fr/charge?evse=FR*ABC*E1');
    expect(appOpenUrl({ ...full, universal: null }, 'FR*ABC*E1')).toBe('monapp://?evse=FR*ABC*E1');
    expect(appOpenUrl({ ...full, evseParam: null }, 'FR*ABC*E1')).toBe('https://go.op.fr/charge');
    expect(appOpenUrl({ scheme: null, universal: null, evseParam: null, ios: null, android: 'com.op.app' })).toBe(null);
  });
  it('cible nulle quand rien n’est renseigné', () => {
    expect(appLaunchTargets(null, 'ios')).toBe(null);
    expect(appLaunchTargets({ scheme: null, universal: null, evseParam: null, ios: null, android: null }, 'ios')).toBe(null);
  });
  it('Tesla réel : passerelle disponible (fiche de store Android), mais JAMAIS comptée comme payable dans Branché', () => {
    const ops: Operator[] = [{ key: 'tesla', names: ['Tesla'], domains: [], payUrl: null }];
    const tesla = { id: 'T', ok: 'tesla', o: 'Tesla', pay: [], c: ['ccs'], kw: 250, p: 1, free: false, acc: 'public', pdc: [['FR*TSL*E1', 250, ['ccs']]] } as unknown as Station;
    const androidOpts = payOptions(tesla, null, ops, { portals: P, wallet: { accounts: [], badges: [] }, os: 'android' });
    const app = appLaunchOption(androidOpts);
    expect(app?.url).toBe('https://play.google.com/store/apps/details?id=com.teslamotors.tesla');
    expect(app?.store).toBe('https://play.google.com/store/apps/details?id=com.teslamotors.tesla');
    expect(surelyPayable(androidOpts)).toBe(false);
    // iOS sans identifiant App Store confirmé : aucune cible → pas de passerelle (dégradation honnête)
    const iosOpts = payOptions(tesla, null, ops, { portals: P, wallet: { accounts: [], badges: [] }, os: 'ios' });
    expect(appLaunchOption(iosOpts)).toBeUndefined();
  });
  it('Lidl réel (appLaunch null) : aucune passerelle', () => {
    const lidl = { id: 'L', ok: 'lidl', o: 'Lidl', pay: [], c: ['t2'], kw: 22, p: 1, free: false, acc: 'public', pdc: [['FR*LDL*E1', 22, ['t2']]] } as unknown as Station;
    expect(appLaunchOption(payOptions(lidl, null, [], { portals: P, wallet: { accounts: [], badges: [] }, os: 'android' }))).toBeUndefined();
  });
});
