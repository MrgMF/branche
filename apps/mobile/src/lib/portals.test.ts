import { describe, expect, it } from 'vitest';
// Portails réels (pipeline/data/operator-portals.json, URL sourcées)
import realPortals from '../../../../pipeline/data/operator-portals.json';
import { copyIdFor, trackedPointEntry } from './methods';
import { idEntryOf, portalPaid, type Portals } from './portals';

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
