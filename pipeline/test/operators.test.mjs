import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug, properName, looksLikeId, operatorKey, isPublicMail, registrableDomain, contactDomains, urlDomains, createOperatorRegistry } from '../src/operators.mjs';
import { createAggregator, toTiles } from '../src/normalize.mjs';

test('slug : accents, casse, formes juridiques', () => {
  assert.equal(slug('IZIVIA'), 'izivia');
  assert.equal(slug('Izivia'), 'izivia');
  assert.equal(slug('Métropolis'), 'metropolis');
  assert.equal(slug('Power Dot France'), 'power-dot');
  assert.equal(slug('Qwello GmbH'), 'qwello');
  assert.equal(slug('Evota Netherlands B.V.'), 'evota-netherlands');
  assert.equal(slug('EVzen (SMEG Développement)'), 'evzen');
  assert.equal(slug('Bouygues Energies & Services'), 'bouygues-energies-services');
  assert.equal(slug('France'), 'france');
});

test('premier nom propre, identifiants ignorés', () => {
  assert.equal(properName('Freshmile | FR*FR1'), 'Freshmile');
  assert.equal(properName('FR*S56 | Morbihan énergies'), 'Morbihan énergies');
  assert.equal(properName('3f2a9c1b-77e0 | Electra'), 'Electra');
  assert.equal(properName('Citeos Mobilité Electrique Paris - Cogelum IDF'), 'Citeos Mobilité Electrique Paris');
  assert.equal(looksLikeId('FR*ABC'), true);
  assert.equal(looksLikeId('a1b2c3d4e5'), true);
  assert.equal(looksLikeId('50five'), false);
  assert.equal(looksLikeId('Electra'), false);
  assert.equal(looksLikeId('Facade'), false); // hexa sans chiffre : un mot
});

test('clé opérateur : nom_operateur, à défaut enseigne puis aménageur', () => {
  assert.deepEqual(operatorKey({ nom_operateur: 'Tesla', nom_enseigne: 'Supercharger' }), { key: 'tesla', name: 'Tesla' });
  assert.equal(operatorKey({ nom_operateur: 'FR*XYZ', nom_enseigne: 'Ionity' }).key, 'ionity');
  assert.equal(operatorKey({ nom_operateur: '', nom_enseigne: '', nom_amenageur: 'Lidl France' }).key, 'lidl');
  assert.equal(operatorKey({ nom_operateur: '', nom_enseigne: '' }), null);
});

test('messageries publiques exclues', () => {
  for (const d of ['gmail.com', 'hotmail.fr', 'outlook.com', 'live.fr', 'yahoo.fr', 'orange.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'icloud.com', 'wanadoo.fr', 'gmx.de', 'gmail.co.uk'])
    assert.equal(isPublicMail(d), true, d);
  assert.equal(isPublicMail('izivia.com'), false);
  assert.equal(isPublicMail('totalenergies.com'), false);
  assert.deepEqual(contactDomains('jean.dupont@gmail.com'), []);
  assert.deepEqual(contactDomains('mairie@wanadoo.fr ; sav@izivia.com'), ['izivia.com']);
});

test('domaine enregistrable', () => {
  assert.equal(registrableDomain('support.izivia.com'), 'izivia.com');
  assert.equal(registrableDomain('support.emobility.fr.group-indigo.com'), 'group-indigo.com');
  assert.equal(registrableDomain('www.shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('pay.borne.com.fr'), 'borne.com.fr');
  assert.equal(registrableDomain('https://www.metropolis-recharge.fr/tarifs'), 'metropolis-recharge.fr');
  assert.equal(registrableDomain('192.168.1.10'), null);
  assert.equal(registrableDomain('localhost'), null);
  assert.deepEqual(contactDomains('support@service.emob.eniplenitude.com'), ['eniplenitude.com']);
  assert.deepEqual(urlDomains('Voir https://www.e-vadea.fr/fr/tarifs ou www.oscea64.fr.'), ['e-vadea.fr', 'oscea64.fr']);
});

test('seuil : domaine de contact gardé à partir de 3 stations, tarification toujours', () => {
  const r = createOperatorRegistry();
  const row = (contact, tarif = '') => ({ nom_operateur: 'Op Test', contact_operateur: contact, contact_amenageur: '', tarification: tarif });
  for (const st of ['s1', 's2', 's3']) r.observe(row('sav@support.optest.fr'), 'op-test', st);
  r.observe(row('a@optest.fr'), 'op-test', 's3'); // même station : ne compte pas deux fois
  for (const st of ['s1', 's2']) r.observe(row('x@rare.fr'), 'op-test', st);
  r.observe(row('', 'https://pay.tarifs-op.com/grille'), 'op-test', 's4');
  const op = r.build().operators[0];
  assert.deepEqual(op, { key: 'op-test', names: ['Op Test'], domains: ['optest.fr', 'tarifs-op.com'], payUrl: null, stations: 4 });
});

test('contact_amenageur pris en compte uniquement si l’aménageur a le slug de l’opérateur', () => {
  const r = createOperatorRegistry();
  for (const st of ['s1', 's2', 's3']) {
    r.observe({ nom_operateur: 'TotalEnergies', contact_operateur: 'ev@totalenergies.com', nom_amenageur: 'ACCOR Hotels', contact_amenageur: 'x@accor.com' }, 'totalenergies', st);
    r.observe({ nom_operateur: 'Izivia', contact_operateur: 'sav@izivia.com', nom_amenageur: 'IZIVIA', contact_amenageur: 'pro@izivia-pro.fr' }, 'izivia', st);
  }
  const ops = Object.fromEntries(r.build().operators.map((o) => [o.key, o.domains]));
  assert.deepEqual(ops.totalenergies, ['totalenergies.com']); // domaine client jamais « officiel »
  assert.deepEqual(ops.izivia, ['izivia-pro.fr', 'izivia.com']);
});

test('agrégation : clé ok sur chaque station des tuiles et registre au format du contrat', () => {
  const a = createAggregator();
  const base = { consolidated_latitude: '48.8', consolidated_longitude: '2.3', contact_operateur: 'sav@izivia.com', contact_amenageur: 'maire@orange.fr' };
  for (let i = 1; i <= 3; i++) a.add({ ...base, nom_operateur: i === 2 ? 'Izivia' : 'IZIVIA', id_station_itinerance: `FRIZIP${i}`, id_pdc_itinerance: `FRIZIE${i}` });
  a.add({ ...base, nom_operateur: 'FR*XX1', nom_enseigne: '', nom_amenageur: '', id_station_itinerance: 'FRXXP1', id_pdc_itinerance: 'FRXXE1' });
  const reg = a.operators();
  assert.equal(reg.v, 1);
  assert.deepEqual(reg.operators, [{ key: 'izivia', names: ['IZIVIA'], domains: ['izivia.com'], payUrl: null, stations: 3 }]);
  const out = [...toTiles(a.stations).values()].flat();
  assert.deepEqual(out.filter((s) => s.ok).map((s) => s.ok), ['izivia', 'izivia', 'izivia']);
  assert.equal(out.find((s) => s.id === 'FRXXP1').ok, undefined);
});
