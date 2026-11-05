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

test('points : id, puissance et prises PAR point (affichage et compatibilité véhicule)', () => {
  const a = createAggregator();
  a.add(row({ id_pdc_itinerance: 'FR*AAA*E1', prise_type_2: 'True', puissance_nominale: '22', cable_t2_attache: 'False' }));
  a.add(row({ id_pdc_itinerance: 'FR*AAA*E2', prise_type_2: 'False', prise_type_combo_ccs: 'True', prise_type_chademo: 'True', puissance_nominale: '150000' }));
  a.add(row({ id_pdc_itinerance: 'FR*AAA*E3', prise_type_2: 'False', prise_type_ef: 'True', puissance_nominale: '3.7', cable_t2_attache: 'True' }));
  const s = a.stations.get('FRAAAP1');
  assert.deepEqual(s.pdc, [
    ['FR*AAA*E1', 22, ['t2']],
    ['FR*AAA*E2', 150, ['ccs', 'chademo']],
    ['FR*AAA*E3', 3.7, ['ef']],
  ]);
  assert.equal(s.cab, true);
  const t = [...toTiles(a.stations).values()][0][0];
  assert.deepEqual(t.pdc[1], ['FR*AAA*E2', 150, ['ccs', 'chademo']]);
  assert.equal(t.extra, undefined);
});

test('tarification conservée jusqu’à 300 caractères (analyse du prix dans l’app)', () => {
  const a = createAggregator();
  const long = 'entre 08:00 et 20:00 : 0.30916667€ par kwh de charge, 3.75€ par heure d’occupation hors charge, '.repeat(4);
  a.add(row({ tarification: long }));
  assert.equal(a.stations.get('FRAAAP1').prix.length, 300);
});

test('index EVSE : seau stable, points au-delà de MAX_PDC retrouvés avec leur station', async () => {
  const { evseIndex, evseBucket, normId, MAX_PDC } = await import('../src/normalize.mjs');
  // Vecteurs partagés avec apps/mobile/src/lib/evse.test.ts
  assert.equal(evseBucket('FR*TST*E0001'), evseBucket('frtste0001'));
  assert.equal(evseBucket('FRTSTE0001'), '2c');
  assert.equal(evseBucket('FR*S61*E123'), '56');
  assert.equal(normId('fr*abc* e1'), 'FRABCE1');
  const a = createAggregator();
  for (let i = 1; i <= MAX_PDC + 2; i++) a.add(row({ id_pdc_itinerance: `FRAAAE${i}` }));
  const s = a.stations.get('FRAAAP1');
  assert.equal(s.pdc.length, MAX_PDC);
  assert.equal(s.p, MAX_PDC + 2);
  const idx = evseIndex(a.stations);
  const look = (id) => idx.get(evseBucket(id))?.[normId(id)];
  assert.equal(look('FRAAAP1'), '195_9');
  assert.equal(look('FR*AAA*E1'), '195_9');
  assert.equal(look(`FRAAAE${MAX_PDC + 2}`), '195_9|FRAAAP1');
});
