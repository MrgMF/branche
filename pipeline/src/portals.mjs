// Portails des opérateurs (data/operator-portals.json) : validation et publication avec les tuiles.
// `payDomains` : hôtes des pages de paiement/démarrage officielles, tirés UNIQUEMENT des URL sourcées de l'entrée ;
// ils sont recopiés dans operators.json (registre lu par le vérificateur de QR codes de l'app), avec `siteDomains`
// (domaines enregistrables de toutes les URL sourcées, hors sites tiers).
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

// Suffixes publics à deux niveaux (même liste que apps/mobile/src/lib/qr.ts registrableDomain).
const TWO_LEVEL = new Set(['co.uk', 'com.fr', 'gouv.fr', 'asso.fr', 'co.jp', 'com.au', 'co.nz', 'com.br', 'com.es', 'co.za']);
export function registrableDomain(host) {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}

/**
 * Sites tiers cités en source (presse, forums, collectivités, université, plateformes partagées ou de paiement) :
 * jamais domaines d'un opérateur. Toute nouvelle source tierce doit être ajoutée ici (test : portals.test.mjs).
 */
export const THIRD_PARTY = new Set([
  'automobile-propre.com', 'largus.fr', 'tesla-mag.com', 'mac4ever.com', 'chargemap.com', 'plugsurfing.com',
  'univ-amu.fr', 'bordeaux-metropole.fr', 'islesurlasorgue.fr', 'intercom.help', 'evc-net.com', 'orios-infos.com',
]);

/** Domaines enregistrables des URL sourcées d'une entrée, hors sites tiers (alizecharge.com, reveocharge.com…). */
export function siteDomainsOf(entry) {
  const out = new Set();
  for (const h of sourcedHosts(entry)) {
    if (!HOST_RE.test(h)) continue;
    const d = registrableDomain(h);
    if (!THIRD_PARTY.has(d)) out.add(d);
  }
  return out;
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
 * Recopie dans le registre, par clé et via `registryKeys` pour une enseigne hors registre (ex. Carrefour Energies,
 * stations exploitées par Allego et Driveco) : les payDomains, et les domaines des sites sourcés (`siteDomains`,
 * hors domaines IRVE déjà connus). Ne crée aucun opérateur.
 */
export function attachPayDomains(registry, portals) {
  const pay = new Map();
  const site = new Map();
  const add = (map, k, list) => {
    const set = map.get(k) ?? new Set();
    for (const d of list) set.add(d);
    map.set(k, set);
  };
  for (const [key, e] of Object.entries(portals?.operators ?? {})) {
    const keys = [key, ...(Array.isArray(e.registryKeys) ? e.registryKeys : [])];
    const sites = siteDomainsOf(e);
    for (const k of keys) {
      if (Array.isArray(e.payDomains) && e.payDomains.length) add(pay, k, e.payDomains);
      if (sites.size) add(site, k, sites);
    }
  }
  return {
    ...registry,
    operators: registry.operators.map((o) => {
      const { payDomains: _old, siteDomains: _oldSite, ...rest } = o;
      const p = pay.get(o.key);
      const sd = [...(site.get(o.key) ?? [])].filter((d) => !(o.domains ?? []).includes(d)).sort();
      return { ...rest, ...(p ? { payDomains: [...p].sort() } : {}), ...(sd.length ? { siteDomains: sd } : {}) };
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
