// Assemble le site GitHub Pages dans ./site :
//   /            landing + pages légales (apps/web)
//   /app/        app Expo exportée pour le web (apps/mobile/dist)
//   /data/       tuiles IRVE (pipeline/dist/data ou $DATA_DIR)
import { cp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
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

// Identité de l'éditeur (variables du dépôt EDITEUR_NOM, CONTACT_EMAIL) dans la landing et les pages légales.
const tokens = { EDITEUR_NOM: process.env.EDITEUR_NOM, CONTACT_EMAIL: process.env.CONTACT_EMAIL };
const missing = Object.entries(tokens).filter(([, v]) => !v?.trim()).map(([k]) => k);
// Sans identité publiée : éditeur non professionnel anonyme (LCEN art. 6, III, 2 — identité tenue par l'hébergeur),
// contact par le suivi public du dépôt GitHub (GITHUB_REPOSITORY fourni par Actions).
const repo = process.env.GITHUB_REPOSITORY ?? 'MrgMF/branche';
const contactUrl = `https://github.com/${repo}/issues`;
const fallback = {
  EDITEUR_NOM: 'un particulier (éditeur non professionnel ; identité communiquée à l’hébergeur, LCEN art. 6, III, 2)',
  CONTACT_EMAIL: 'le suivi public du projet sur GitHub (messages visibles de tous)',
};
const pages = ['index.html', 'en/index.html', ...(await readdir(resolve(out, 'legal'))).map((f) => `legal/${f}`)].filter((f) => f.endsWith('.html'));
for (const f of pages) {
  const path = resolve(out, f);
  let html = await readFile(path, 'utf8');
  if (!tokens.CONTACT_EMAIL?.trim()) html = html.replace(/mailto:\{\{CONTACT_EMAIL\}\}(\?[^"]*)?/g, contactUrl);
  for (const [k, v] of Object.entries(tokens)) html = html.replaceAll(`{{${k}}}`, (v?.trim() ? v : fallback[k]).replace(/[<>"&]/g, ''));
  await writeFile(path, html);
}
if (missing.length) console.warn(`Attention : ${missing.join(', ')} non renseigné(s) — à définir avant publication.`);

// Routes de l'app (SPA) : GitHub Pages sert 404.html pour les chemins inconnus.
await writeFile(resolve(out, '404.html'), await readFile(resolve(appDist, 'index.html')));
await writeFile(resolve(out, '.nojekyll'), '');
console.log(`Site assemblé dans ${out}`);
