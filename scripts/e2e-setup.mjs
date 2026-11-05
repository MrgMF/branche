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
console.log(`E2E : opérateur de test ajouté (${reg.operators.length} opérateurs), zone de danger de test écrite.`);
