// Assemble le site GitHub Pages dans ./site :
//   /            landing + pages légales (apps/web)
//   /app/        app Expo exportée pour le web (apps/mobile/dist)
//   /data/       tuiles IRVE (pipeline/dist/data ou $DATA_DIR)
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'site');
const exists = (p) => access(p).then(() => true, () => false);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, 'apps/web'), out, { recursive: true });

const appDist = resolve(root, 'apps/mobile/dist');
if (!(await exists(appDist))) throw new Error('apps/mobile/dist manquant : lancez `npm run build:web -w apps/mobile`.');
await cp(appDist, resolve(out, 'app'), { recursive: true });

const dataDir = resolve(root, process.env.DATA_DIR ?? 'pipeline/dist/data');
if (await exists(dataDir)) await cp(dataDir, resolve(out, 'data'), { recursive: true });
else console.warn(`Attention : pas de données (${dataDir}). Lancez \`npm run data\`.`);

// MapLibre servi par notre domaine (pas de CDN tiers par défaut).
await mkdir(resolve(out, 'vendor'), { recursive: true });
for (const f of ['maplibre-gl.js', 'maplibre-gl.css']) await cp(resolve(root, 'node_modules/maplibre-gl/dist', f), resolve(out, 'vendor', f));

// Routes de l'app (SPA) : GitHub Pages sert 404.html pour les chemins inconnus.
await writeFile(resolve(out, '404.html'), await readFile(resolve(appDist, 'index.html')));
await writeFile(resolve(out, '.nojekyll'), '');
console.log(`Site assemblé dans ${out}`);
