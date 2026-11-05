// Prépare ./site pour les tests E2E locaux UNIQUEMENT (jamais en CI de déploiement) :
// ajoute l'opérateur de test (CPO local :8090) au registre et une zone de danger de test près d'Antony.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.CI) throw new Error('e2e-setup ne doit jamais tourner en CI de déploiement.');
const data = resolve(import.meta.dirname, '..', 'site', 'data');
const opsPath = resolve(data, 'operators.json');
const reg = JSON.parse(await readFile(opsPath, 'utf8'));
reg.operators = reg.operators.filter((o) => o.key !== 'test');
reg.operators.push({ key: 'test', names: ['Opérateur Test'], domains: ['localhost:8090'], payUrl: null, stations: 0 });
await writeFile(opsPath, JSON.stringify(reg));
await writeFile(resolve(data, 'danger-zones.json'), JSON.stringify({ v: 1, test: true, zones: [{ id: 'test-1', lon: 2.2985, lat: 48.7552, radiusM: 300 }] }));
// Borne de test de l'opérateur de test (pour le parcours « domaine de l'opérateur » vert), à ~700 m d'Antony centre.
const tilePath = resolve(data, 'tiles', '195_9.json');
const tile = JSON.parse(await readFile(tilePath, 'utf8'));
tile.s = tile.s.filter((x) => x.id !== 'FRTSTP0001');
tile.s.push({ id: 'FRTSTP0001', n: 'Borne de test (CPO local)', o: 'Opérateur Test', ok: 'test', lat: 48.7585, lon: 2.3035, p: 1, kw: 22, c: ['t2'], pay: ['qr_dynamique'], pdc: [['FRTSTE0001', 22]] });
await writeFile(tilePath, JSON.stringify(tile));
console.log(`E2E : opérateur de test ajouté (${reg.operators.length} opérateurs), zone de danger de test écrite.`);
