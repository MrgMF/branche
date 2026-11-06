// Portails des opérateurs (data/operator-portals.json) : validation et publication avec les tuiles.
// `payDomains` : hôtes des pages de paiement/démarrage officielles, tirés UNIQUEMENT des URL sourcées de l'entrée ;
// ils sont recopiés dans operators.json (registre lu par le vérificateur de QR codes de l'app).
// Usage autonome (sans retraiter l'IRVE) : node src/portals.mjs --out dossier_data
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const PORTALS_SRC = resolve(import.meta.dirname, '..', 'data', 'operator-portals.json');

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Hôtes présents dans les URL d'une entrée (webPortal, webStart, adhocWeb, sources). */
export function sourcedHosts(entry) {
  const texts = [entry.webPortal, entry.webStart?.url, typeof entry.adhocWeb === 'string' ? entry.adhocWeb : null, ...(entry.sources ?? [])];
  const hosts = new Set();
  for (const t of texts) {
    if (typeof t !== 'string') continue;
    for (const m of t.matchAll(/https?:\/\/([^/\s()«»"]+)/gi)) hosts.add(m[1].toLowerCase().replace(/:\d+$/, '').replace(/\.$/, ''));
  }
  return hosts;
}

/** Erreurs de forme : payDomains hors des URL sourcées, preauthMax non numérique, clés de registre invalides. */
export function validatePortals(portals) {
  const errors = [];
  if (portals?.v !== 1 || !portals.operators || typeof portals.operators !== 'object') return ['format inattendu (v1, operators)'];
  for (const [key, e] of Object.entries(portals.operators)) {
    if (e.payDomains != null) {
      if (!Array.isArray(e.payDomains)) errors.push(`${key}.payDomains : tableau attendu`);
      else {
        const hosts = sourcedHosts(e);
        for (const d of e.payDomains) {
          if (typeof d !== 'string' || !HOST_RE.test(d)) errors.push(`${key}.payDomains : hôte invalide ${d}`);
          else if (!hosts.has(d)) errors.push(`${key}.payDomains : ${d} absent des URL sourcées de l'entrée`);
        }
      }
    }
    if (e.preauthMax != null && !(typeof e.preauthMax === 'number' && e.preauthMax > 0 && e.preauthMax <= 500)) errors.push(`${key}.preauthMax : montant en € attendu`);
    if (e.registryKeys != null && !(Array.isArray(e.registryKeys) && e.registryKeys.every((k) => typeof k === 'string' && k))) errors.push(`${key}.registryKeys : clés attendues`);
  }
  return errors;
}

/**
 * Recopie les payDomains dans le registre : par clé, et via `registryKeys` pour une enseigne hors registre
 * (ex. Carrefour Energies, stations exploitées par Allego et Driveco). Ne crée aucun opérateur.
 */
export function attachPayDomains(registry, portals) {
  const byKey = new Map();
  for (const [key, e] of Object.entries(portals?.operators ?? {})) {
    if (!Array.isArray(e.payDomains) || !e.payDomains.length) continue;
    for (const k of [key, ...(Array.isArray(e.registryKeys) ? e.registryKeys : [])]) {
      const set = byKey.get(k) ?? new Set();
      for (const d of e.payDomains) set.add(d);
      byKey.set(k, set);
    }
  }
  return {
    ...registry,
    operators: registry.operators.map((o) => {
      const { payDomains: _old, ...rest } = o;
      const set = byKey.get(o.key);
      return set ? { ...rest, payDomains: [...set].sort() } : rest;
    }),
  };
}

export async function readPortals(path = PORTALS_SRC) {
  const portals = JSON.parse(await readFile(path, 'utf8'));
  const errors = validatePortals(portals);
  if (errors.length) throw new Error(`operator-portals.json invalide :\n- ${errors.join('\n- ')}`);
  return portals;
}

/** Écrit operator-portals.json et ajoute les payDomains au registre déjà présent dans outDir. */
export async function publishPortals(outDir, registry, path = PORTALS_SRC) {
  const portals = await readPortals(path);
  await writeFile(join(outDir, 'operator-portals.json'), JSON.stringify(portals));
  const reg = registry ?? JSON.parse(await readFile(join(outDir, 'operators.json'), 'utf8'));
  const next = attachPayDomains(reg, portals);
  await writeFile(join(outDir, 'operators.json'), JSON.stringify(next));
  return next;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = resolve(i >= 0 ? args[i + 1] : 'dist/data');
  const reg = await publishPortals(out);
  const n = reg.operators.filter((o) => o.payDomains).length;
  console.log(`OK : operator-portals.json publié, payDomains ajoutés à ${n} opérateurs du registre → ${out}`);
}
