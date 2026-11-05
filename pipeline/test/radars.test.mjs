import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseOverpass, parseGouvCsv, dedupe, zoneFor, mergeZones, buildZones, distanceM, radiusFor,
  RADIUS, OFFSET_MIN, OFFSET_MAX, MIN_GAP_M,
} from '../src/radars.mjs';

const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const osm = parseOverpass(JSON.parse(await readFile(fx('overpass-radars.json'), 'utf8')));
const gouv = parseGouvCsv(await readFile(fx('radars-gouv.csv'), 'utf8'));
const all = [...osm, ...gouv];
const run = promisify(execFile);
const script = new URL('../src/radars.mjs', import.meta.url).pathname;

test('sources : parsing OSM et data.gouv, positions invalides ignorées', () => {
  assert.equal(osm.length, 8); // (0,0) et way ignorés
  assert.equal(gouv.length, 6); // ligne sans coordonnées ignorée
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  assert.equal(byId['osm:266093421'].highway, true); // ref A6
  assert.equal(byId['osm:1185023377'].urban, true); // zone:traffic urban
  assert.equal(byId['osm:3012774410'].urban, false); // rural
  assert.equal(byId['osm:5523981042'].urban, null); // aucune info
  assert.equal(byId['gouv:62890'].highway, true); // route « A 1 »
  assert.equal(byId['gouv:32051'].urban, true); // feu rouge
  assert.equal(byId['gouv:40817'].urban, false); // hors agglomération
});

test('rayons : 4000 autoroute, 500 agglomération, 2000 sinon', () => {
  assert.equal(radiusFor({ highway: true, urban: true }), RADIUS.highway);
  assert.equal(radiusFor({ highway: false, urban: true }), 500);
  assert.equal(radiusFor({ highway: false, urban: false }), 2000);
  assert.equal(radiusFor({ highway: false, urban: null }), 2000);
});

test('dédoublonnage < 150 m entre sources et dans une source', () => {
  const u = dedupe(all);
  assert.equal(u.length, all.length - 3); // A6 OSM/gouv, Tours OSM/gouv, A8 OSM×2
  const a6 = u.find((r) => r.ids.includes('osm:266093421'));
  assert.deepEqual(a6.ids.sort(), ['gouv:21120', 'osm:266093421']);
  const a8 = u.find((r) => r.ids.includes('osm:7741002233'));
  assert.equal(a8.highway, true); // l'info autoroute est conservée à la fusion
  // Deux radars à 200 m restent distincts.
  const p = { id: 'a', lat: 48, lon: 2, highway: false, urban: null };
  assert.equal(dedupe([p, { ...p, id: 'b', lat: 48 + 200 / 111195 }]).length, 2);
});

test('décalage déterministe et borné entre 15 % et 40 % du rayon', () => {
  for (let i = 0; i < 500; i++) {
    const r = { id: `t:${i}`, lat: 42 + (i % 50) * 0.13, lon: -1 + (i % 37) * 0.21, highway: i % 3 === 0, urban: i % 3 === 1 };
    const z = zoneFor(r, 'sel');
    const d = distanceM(z, r);
    assert.ok(d >= OFFSET_MIN * z.radiusM - 0.5 && d <= OFFSET_MAX * z.radiusM + 0.5, `${r.id} : ${d} / ${z.radiusM}`);
    assert.deepEqual(zoneFor(r, 'sel'), z); // déterministe
  }
  const r = { id: 'x', lat: 48, lon: 2, highway: false, urban: null };
  assert.notDeepEqual(zoneFor(r, 'sel1'), zoneFor(r, 'sel2')); // le sel change le décalage
});

test('fusion des zones qui se chevauchent fortement, chaque zone d’origine reste couverte', () => {
  const z = (id, lat, lon, radiusM = 2000) => ({ lat, lon, radiusM, members: [{ lat, lon }], ids: [id] });
  const zones = [z('m1', 48, 2), z('m2', 48.005, 2), z('m3', 48.0, 2.0135, 500), z('far', 49, 3), z('near', 48.02, 2)];
  // m2 à ~556 m de m1 (< 50 % de 2000) → fusion ; « near » à ~2,2 km → chevauchement faible, conservée.
  const merged = mergeZones(zones);
  assert.equal(merged.length, 4);
  const big = merged.find((z) => z.ids.includes('m1'));
  assert.deepEqual(big.ids, ['m1', 'm2']);
  for (const o of zones.filter((x) => big.ids.includes(x.ids[0]))) assert.ok(distanceM(big, o) + o.radiusM <= big.radiusM + 1);
  assert.ok(merged.some((z) => z.ids.includes('far') && z.ids.length === 1));
});

test('sortie : aucune position de radar, chaque radar dans une zone, format du contrat', () => {
  const { zones, stats } = buildZones(all, { salt: 'test' });
  assert.ok(zones.length > 0 && zones.length <= stats.unique);
  for (const z of zones) {
    assert.deepEqual(Object.keys(z).sort(), ['id', 'lat', 'lon', 'radiusM']);
    assert.ok([RADIUS.urban, RADIUS.default, RADIUS.highway].some((r) => z.radiusM >= r));
  }
  for (const r of all) {
    for (const z of zones) {
      assert.ok(!(z.lat === r.lat && z.lon === r.lon), `zone ${z.id} au radar ${r.id}`);
      assert.ok(distanceM(z, r) >= MIN_GAP_M, `zone ${z.id} trop proche de ${r.id}`);
    }
    assert.ok(zones.some((z) => distanceM(z, r) <= z.radiusM), `radar ${r.id} hors zone`);
  }
  const json = JSON.stringify(zones);
  for (const r of all) assert.ok(!json.includes(String(r.lat)) || !json.includes(String(r.lon)));
  assert.deepEqual(buildZones(all, { salt: 'test' }).zones, zones); // stable d'un jour à l'autre
});

test('CLI : fixtures → danger-zones.json ; aucune source → échec sans fichier', async () => {
  const out = await mkdtemp(join(tmpdir(), 'radars-'));
  await run(process.execPath, [script, '--out', out, '--osm', fx('overpass-radars.json').pathname, '--gouv', fx('radars-gouv.csv').pathname], { env: { ...process.env, RADAR_SALT: 't' } });
  const data = JSON.parse(await readFile(join(out, 'danger-zones.json'), 'utf8'));
  assert.equal(data.v, 1);
  assert.equal(data.sources.length, 2);
  assert.ok(data.zones.length > 0);

  const empty = await mkdtemp(join(tmpdir(), 'radars-'));
  const bad = join(empty, 'vide.csv');
  await writeFile(bad, 'id,latitude,longitude\n');
  const env = { ...process.env, OVERPASS_URL: 'http://127.0.0.1:9/', RADARS_URL: 'http://127.0.0.1:9/' };
  await assert.rejects(run(process.execPath, [script, '--out', join(empty, 'out'), '--gouv', bad], { env }), /Aucune source/);
  await assert.rejects(run(process.execPath, [script, '--out', join(empty, 'out2')], { env }), /Aucune source/);
  assert.deepEqual((await readdir(empty)).sort(), ['vide.csv']);
});
