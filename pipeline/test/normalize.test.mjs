import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bool, coords, powerKw, tileKey, createAggregator, toTiles } from '../src/normalize.mjs';

const row = (o) => ({
  nom_station: 'Gare', id_station_itinerance: 'FRAAAP1', id_pdc_itinerance: 'FRAAAE1', coordonneesXY: '[2.3, 48.75]',
  consolidated_latitude: '48.75', consolidated_longitude: '2.3', puissance_nominale: '22', prise_type_2: 'True',
  paiement_cb: 'False', paiement_acte: 'True', condition_acces: 'Accès libre', nom_operateur: 'Op', ...o,
});

test('bool', () => {
  for (const v of ['true', 'True', '1', 'vrai']) assert.equal(bool(v), true);
  for (const v of ['false', '', null, '0']) assert.equal(bool(v), false);
});

test('coords : colonnes consolidées puis coordonneesXY', () => {
  assert.deepEqual(coords({ consolidated_latitude: '48.1', consolidated_longitude: '2.2' }), { lat: 48.1, lon: 2.2 });
  assert.deepEqual(coords({ coordonneesXY: '[2.36761, 49.87723]' }), { lat: 49.87723, lon: 2.36761 });
  assert.equal(coords({ coordonneesXY: '[0, 0]' }), null);
  assert.equal(coords({ consolidated_latitude: '95', consolidated_longitude: '2' }), null);
});

test('powerKw convertit les watts', () => {
  assert.equal(powerKw({ puissance_nominale: '22' }), 22);
  assert.equal(powerKw({ puissance_nominale: '150000' }), 150);
  assert.equal(powerKw({ puissance_nominale_kw: '7.4' }), 7.4);
});

test('tileKey grille 0,25°', () => {
  assert.equal(tileKey(48.76, 2.3), '195_9');
  assert.equal(tileKey(-21.1, 55.5), '-85_222');
});

test('agrégation par station, dédoublonnage des points', () => {
  const a = createAggregator();
  a.add(row({}));
  a.add(row({})); // doublon
  a.add(row({ id_pdc_itinerance: 'FRAAAE2', puissance_nominale: '150', prise_type_combo_ccs: 'True', paiement_cb: 'True' }));
  a.add(row({ id_station_itinerance: 'FRBBBP1', id_pdc_itinerance: 'FRBBBE1', consolidated_latitude: '', consolidated_longitude: '', coordonneesXY: '' }));
  const st = a.stats();
  assert.equal(st.stations, 1);
  assert.equal(st.pdc, 2);
  assert.equal(st.skipped, 1);
  const s = a.stations.get('FRAAAP1');
  assert.equal(s.kw, 150);
  assert.deepEqual(s.c.sort(), ['ccs', 't2']);
  assert.deepEqual(s.pay.sort(), ['acte', 'cb']);
  const tiles = toTiles(a.stations);
  assert.equal(tiles.size, 1);
  const t = [...tiles.values()][0][0];
  assert.equal(t.acc, undefined);
  assert.equal(t.pdc.length, 2);
});
