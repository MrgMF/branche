import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachPayDomains, publishPortals, readPortals, siteDomainsOf, sourcedHosts, THIRD_PARTY, validatePortals } from '../src/portals.mjs';

test('operator-portals.json réel : valide, payDomains tous tirés des URL sourcées de leur entrée', async () => {
  const p = await readPortals();
  assert.deepEqual(validatePortals(p), []);
  const pay = Object.fromEntries(Object.entries(p.operators).filter(([, e]) => e.payDomains).map(([k, e]) => [k, e.payDomains]));
  assert.deepEqual(pay['engie-vianeo'], ['charge.engie-vianeo.com']);
  assert.deepEqual(pay.qwello, ['wa.qwello.eu']);
  assert.deepEqual(pay.virta, ['chge.eu']);
  assert.ok(pay.freshmile.includes('xfm.fr'));
  assert.deepEqual(pay['carrefour-energies'], ['recharge.carrefour.fr']);
  for (const [k, list] of Object.entries(pay)) for (const d of list) assert.ok(sourcedHosts(p.operators[k]).has(d), `${k} : ${d}`);
  // Opérateurs « appli seule » : aucun domaine de paiement
  for (const k of ['lidl', 'soregies', 'soregies-mobilites', 'seolis', 'yes55']) assert.equal(p.operators[k].payDomains, undefined, k);
});

test('preauthMax seulement quand la source publie le montant', async () => {
  const p = await readPortals();
  const withMax = Object.entries(p.operators).filter(([, e]) => e.preauthMax != null).map(([k, e]) => [k, e.preauthMax]);
  assert.deepEqual(Object.fromEntries(withMax), { 'bouygues-energies-services': 75, 'engie-vianeo': 50, 'reveo-syaden': 75 });
  for (const [k] of withMax) assert.match(`${p.operators[k].adhocWeb ?? ''} ${p.operators[k].notes ?? ''}`, /75 €|50 €/, k);
});

test('validation : domaine inventé, montant non numérique', () => {
  const bad = { v: 1, operators: { x: { name: 'X', webStart: { url: 'https://pay.x.fr/' }, payDomains: ['pay.x.fr', 'evil.x.com'], preauthMax: '75 €' } } };
  const errors = validatePortals(bad);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /evil\.x\.com absent/);
  assert.match(errors[1], /preauthMax/);
});

test('registre : payDomains recopiés par clé et via registryKeys (Carrefour → Allego, Driveco)', () => {
  const reg = { v: 1, operators: [{ key: 'allego', names: ['Allego'], domains: ['allego.eu'], payUrl: null }, { key: 'virta', names: ['Virta'], domains: ['virta.global'], payUrl: null }, { key: 'lidl', names: ['Lidl'], domains: ['lidl.fr'], payUrl: null }] };
  const portals = { v: 1, operators: { virta: { payDomains: ['chge.eu'] }, 'carrefour-energies': { payDomains: ['recharge.carrefour.fr'], registryKeys: ['allego', 'driveco'] } } };
  const out = attachPayDomains(reg, portals);
  assert.deepEqual(out.operators.map((o) => o.payDomains ?? null), [['recharge.carrefour.fr'], ['chge.eu'], null]);
  assert.equal(out.operators.length, 3); // aucun opérateur créé (driveco absent du registre de test)
});

test('publication autonome dans un dossier de données existant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'portals-'));
  await writeFile(join(dir, 'operators.json'), JSON.stringify({ v: 1, operators: [{ key: 'qwello', names: ['Qwello'], domains: ['qwello.fr'], payUrl: null }] }));
  await publishPortals(dir);
  const reg = JSON.parse(await readFile(join(dir, 'operators.json'), 'utf8'));
  assert.deepEqual(reg.operators[0].payDomains, ['wa.qwello.eu']);
  const pub = JSON.parse(await readFile(join(dir, 'operator-portals.json'), 'utf8'));
  assert.equal(pub.operators['reveo-syaden'].preauthMax, 75);
});

test('siteDomains : tous les domaines des URL sourcées (alizecharge.com, reveocharge.com, engie-vianeo.com…), hors sites tiers', async () => {
  const p = await readPortals();
  assert.deepEqual([...siteDomainsOf(p.operators['bouygues-energies-services'])].sort(), ['alizecharge.com', 'reveocharge.com']);
  assert.deepEqual([...siteDomainsOf(p.operators['engie-vianeo'])], ['engie-vianeo.com']);
  assert.deepEqual([...siteDomainsOf(p.operators.virta)].sort(), ['chge.eu', 'virta.global']);
  // Presse, forums, université, plateformes partagées : jamais domaines d'un opérateur
  assert.deepEqual([...siteDomainsOf(p.operators.tesla)], ['tesla.com']);
  assert.deepEqual([...siteDomainsOf(p.operators.freshmile)].sort(), ['freshmile.com', 'xfm.fr']);
  for (const [k, e] of Object.entries(p.operators)) for (const d of siteDomainsOf(e)) assert.ok(!THIRD_PARTY.has(d), `${k} : ${d}`);
  // Chaque source tierce connue est bien exclue (une nouvelle source tierce doit être ajoutée à THIRD_PARTY)
  const all = new Set(Object.values(p.operators).flatMap((e) => [...siteDomainsOf(e)]));
  for (const d of ['univ-amu.fr', 'largus.fr', 'tesla-mag.com', 'chargemap.com', 'mac4ever.com', 'automobile-propre.com', 'evc-net.com']) assert.ok(!all.has(d), d);
});

test('registre : siteDomains recopiés (hors domaines IRVE déjà connus), aussi via registryKeys', () => {
  const reg = {
    v: 1,
    operators: [
      { key: 'bouygues-energies-services', names: ['Bouygues'], domains: ['alizecharge.fr'], payUrl: null },
      { key: 'reveo-syaden', names: ['Révéo'], domains: ['reveocharge.com'], payUrl: null },
      { key: 'allego', names: ['Allego'], domains: ['allego.eu'], payUrl: null },
    ],
  };
  const portals = {
    v: 1,
    operators: {
      'bouygues-energies-services': { sources: ['https://alizecharge.com/', 'https://support.reveocharge.com/x', 'https://www.largus.fr/a'] },
      'reveo-syaden': { webPortal: 'https://my.reveocharge.com/fr/login' },
      'carrefour-energies': { webStart: { url: 'https://recharge.carrefour.fr/' }, payDomains: ['recharge.carrefour.fr'], registryKeys: ['allego'], sources: ['https://www.mac4ever.com/x'] },
    },
  };
  const out = attachPayDomains(reg, portals);
  assert.deepEqual(out.operators[0].siteDomains, ['alizecharge.com', 'reveocharge.com']);
  assert.equal(out.operators[1].siteDomains, undefined); // reveocharge.com déjà domaine IRVE
  assert.deepEqual(out.operators[2].siteDomains, ['carrefour.fr']);
  assert.deepEqual(out.operators[2].payDomains, ['recharge.carrefour.fr']);
});

test('Tesla : appli seule (source Tesla), lecteur CB seulement « sur certains sites »', async () => {
  const p = await readPortals();
  assert.equal(p.operators.tesla.appOnly, true);
  assert.equal(p.operators.tesla.adhocWeb, null);
  assert.ok(p.operators.tesla.sources.some((u) => u.startsWith('https://www.tesla.com/support/charging/supercharging-other-evs')));
  assert.match(p.operators.tesla.notes, /sites sélectionnés/);
});
