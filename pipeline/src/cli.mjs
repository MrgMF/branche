// Usage : node src/cli.mjs [--input fichier.csv] [--out dossier]
// Sans --input : télécharge la base nationale IRVE consolidée (data.gouv.fr).
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse';
import { createAggregator, evseIndex, toTiles, TILE_SIZE } from './normalize.mjs';
import { publishPortals } from './portals.mjs';

const DEFAULT_URL = 'https://www.data.gouv.fr/api/1/datasets/r/eb76d20a-8501-400e-b336-d85724de5435';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const input = arg('--input');
const outDir = resolve(arg('--out') ?? 'dist/data');
const sourceUrl = process.env.IRVE_URL ?? DEFAULT_URL;

async function source() {
  if (input) return createReadStream(input);
  const res = await fetch(sourceUrl, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Téléchargement IRVE impossible : HTTP ${res.status}`);
  return Readable.fromWeb(res.body);
}

const agg = createAggregator();
const parser = (await source()).pipe(parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true }));
for await (const row of parser) agg.add(row);

const st = agg.stats();
if (st.stations < (input ? 1 : 1000)) throw new Error(`Trop peu de stations (${st.stations}) : source invalide ?`);

const tiles = toTiles(agg.stations);
await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'tiles'), { recursive: true });
for (const [k, list] of tiles) await writeFile(join(outDir, 'tiles', `${k}.json`), JSON.stringify({ v: 1, s: list }));
await mkdir(join(outDir, 'evse'), { recursive: true });
const index = evseIndex(agg.stations);
for (const [b, m] of index) await writeFile(join(outDir, 'evse', `${b}.json`), JSON.stringify({ v: 1, m }));
const meta = {
  v: 1,
  generatedAt: new Date().toISOString(),
  source: input ? `fichier local ${input}` : sourceUrl,
  license: 'Licence Ouverte / Open Licence 2.0 — base nationale IRVE, data.gouv.fr',
  tileSize: TILE_SIZE,
  stations: st.stations,
  pdc: st.pdc,
  tiles: [...tiles.keys()].sort(),
  evseBuckets: index.size,
};
await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta));
// Portails des opérateurs (site officiel, démarrage web, paiement ponctuel, badges, payDomains) : validés puis publiés ;
// les payDomains sont recopiés dans operators.json (vérificateur de QR codes de l'app).
let registry = agg.operators();
try {
  registry = await publishPortals(outDir, registry);
} catch (e) {
  if (e?.code !== 'ENOENT') throw e;
  console.warn('operator-portals.json absent : l’app utilise la base IRVE seule.');
  await writeFile(join(outDir, 'operators.json'), JSON.stringify(registry));
}
console.log(`OK : ${st.rows} lignes, ${st.skipped} ignorées, ${st.stations} stations, ${st.pdc} points, ${tiles.size} tuiles, ${registry.operators.length} opérateurs → ${outDir}`);
