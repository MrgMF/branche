import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachPayDomains, publishPortals, readPortals, sourcedHosts, validatePortals } from '../src/portals.mjs';

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
