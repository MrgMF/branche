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

/**
 * Hôtes exacts des URL sourcées d'une entrée, hors sites tiers (alizecharge.com, support.alizecharge.com…) : seuls ces
 * hôtes valent « Site officiel » au vérificateur de QR ; un autre sous-domaine du même site demande confirmation.
 */
export function siteHostsOf(entry) {
  const out = new Set();
  for (const h of sourcedHosts(entry)) {
    if (HOST_RE.test(h) && !THIRD_PARTY.has(registrableDomain(h))) out.add(h.replace(/^www\./, ''));
  }
  return out;
}

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

/**
 * Saisie du point sur la page de paiement : `emi3` (identifiant IRVE, copié par Branché), `printed` (numéro inscrit sur
 * la borne, ex. Virta : 4–5 chiffres), `select` (choix du point dans une liste sur la page), null si non documenté.
 */
export const ID_ENTRIES = new Set(['emi3', 'printed', 'select']);

// Lien profond vers l'appli de l'opérateur (passerelle « Démarrer avec l'appli », comme un lien Waze) : schéma/URL
// PUBLICS seulement, aucune imitation ni identifiant. `scheme` (ex. « monappli:// »), `universal` (universal link https),
// `evseParam` (paramètre qui cible une borne précise, requiert scheme ou universal), `ios` (fiche App Store),
// `android` (nom de paquet → fiche Google Play), `sources` (URL confirmant ce qui précède). null = rien de confirmé.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:(\/\/)?$/i;
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;
/** Valide un bloc appLaunch (null autorisé). Chaque champ confirmé exige au moins une source https. */
export function validateAppLaunch(key, a, errors) {
  if (a === undefined || a === null) return;
  if (typeof a !== 'object' || Array.isArray(a)) {
    errors.push(`${key}.appLaunch : objet ou null attendu`);
    return;
  }
  const str = (v, name) => {
    if (v != null && typeof v !== 'string') errors.push(`${key}.appLaunch.${name} : chaîne ou null attendue`);
  };
  str(a.scheme, 'scheme');
  str(a.universal, 'universal');
  str(a.evseParam, 'evseParam');
  str(a.ios, 'ios');
  str(a.android, 'android');
  if (typeof a.scheme === 'string' && !SCHEME_RE.test(a.scheme)) errors.push(`${key}.appLaunch.scheme : schéma attendu (ex. « app:// »)`);
  if (typeof a.universal === 'string' && !/^https:\/\/\S+$/.test(a.universal)) errors.push(`${key}.appLaunch.universal : URL https attendue`);
  if (typeof a.ios === 'string' && !/^https:\/\/apps\.apple\.com\/\S+$/.test(a.ios)) errors.push(`${key}.appLaunch.ios : URL App Store (apps.apple.com) attendue`);
  if (typeof a.android === 'string' && !PACKAGE_RE.test(a.android)) errors.push(`${key}.appLaunch.android : nom de paquet attendu (ex. « com.exemple.appli »)`);
  if (a.evseParam != null && !a.scheme && !a.universal) errors.push(`${key}.appLaunch.evseParam : requiert scheme ou universal`);
  const confirmed = [a.scheme, a.universal, a.ios, a.android].some((v) => typeof v === 'string' && v);
  if (confirmed && !(Array.isArray(a.sources) && a.sources.some((u) => typeof u === 'string' && /^https:\/\//.test(u)))) {
    errors.push(`${key}.appLaunch : une source https est requise dès qu'un lien est renseigné`);
  }
}

/**
 * Moyens de paiement (docs/research/payment-methods.md) : `true`/`false` seulement si une source le dit, sinon null ;
 * `"probable"` = lecteur sans contact confirmé sans que Apple Pay ni Google Pay soient cités. L'app n'affiche que `true`
 * (et `"probable"` du lecteur, formulé comme tel).
 */
export const PAY_ADHOC = ['card', 'applePay', 'googlePay', 'paypal'];
export const PAY_READER = ['contactless', 'nfcWallets'];
const PAY_VALUE = (v) => v === true || v === false || v === null || v === 'probable';

/** Erreurs de forme de `payMethods` (valeurs, `other`, sources https obligatoires dès qu'une valeur est connue). */
export function payMethodsErrors(key, pm) {
  if (pm == null) return [];
  if (typeof pm !== 'object' || Array.isArray(pm)) return [`${key}.payMethods : objet attendu`];
  const errors = [];
  const adhoc = pm.adhoc ?? {};
  const reader = pm.reader ?? {};
  let known = false;
  for (const [part, obj, keys] of [['adhoc', adhoc, PAY_ADHOC], ['reader', reader, PAY_READER]]) {
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      errors.push(`${key}.payMethods.${part} : objet attendu`);
      continue;
    }
    for (const k of keys) {
      const v = obj[k] ?? null;
      if (!PAY_VALUE(v)) errors.push(`${key}.payMethods.${part}.${k} : true, false, null ou "probable" attendu`);
      else if (v !== null) known = true;
    }
  }
  if (adhoc.other != null && !(Array.isArray(adhoc.other) && adhoc.other.every((x) => typeof x === 'string' && x.trim()))) errors.push(`${key}.payMethods.adhoc.other : noms attendus`);
  if (Array.isArray(adhoc.other) && adhoc.other.length) known = true;
  if (reader.nfcWallets === 'probable' && reader.contactless !== true) errors.push(`${key}.payMethods.reader.nfcWallets : « probable » exige un lecteur sans contact confirmé`);
  const sources = pm.sources ?? [];
  if (!Array.isArray(sources) || !sources.every((u) => typeof u === 'string' && /^https:\/\/\S+$/.test(u))) errors.push(`${key}.payMethods.sources : URL https attendues`);
  else if (known && !sources.length) errors.push(`${key}.payMethods : valeur connue sans source`);
  return errors;
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
    if (e.idEntry != null && !ID_ENTRIES.has(e.idEntry)) errors.push(`${key}.idEntry : emi3, printed ou select attendu`);
    if (e.idDigits != null) {
      const ok = Array.isArray(e.idDigits) && e.idDigits.length === 2 && e.idDigits.every((n) => Number.isInteger(n) && n > 0 && n <= 20) && e.idDigits[0] <= e.idDigits[1];
      if (!ok) errors.push(`${key}.idDigits : [min, max] attendu`);
      else if (e.idEntry !== 'printed') errors.push(`${key}.idDigits : réservé à idEntry « printed »`);
    }
    errors.push(...payMethodsErrors(key, e.payMethods));
    if (e.registryKeys != null && !(Array.isArray(e.registryKeys) && e.registryKeys.every((k) => typeof k === 'string' && k))) errors.push(`${key}.registryKeys : clés attendues`);
    validateAppLaunch(key, e.appLaunch, errors);
  }
  return errors;
}

/**
 * Recopie dans le registre, par clé et via `registryKeys` pour une enseigne hors registre (ex. Carrefour Energies,
 * stations exploitées par Allego et Driveco) : les payDomains, les domaines des sites sourcés (`siteDomains`,
 * hors domaines IRVE déjà connus) et leurs hôtes exacts (`siteHosts`). Ne crée aucun opérateur.
 */
export function attachPayDomains(registry, portals) {
  const pay = new Map();
  const site = new Map();
  const siteHosts = new Map();
  const add = (map, k, list) => {
    const set = map.get(k) ?? new Set();
    for (const d of list) set.add(d);
    map.set(k, set);
  };
  for (const [key, e] of Object.entries(portals?.operators ?? {})) {
    const keys = [key, ...(Array.isArray(e.registryKeys) ? e.registryKeys : [])];
    const sites = siteDomainsOf(e);
    const hosts = siteHostsOf(e);
    for (const k of keys) {
      if (Array.isArray(e.payDomains) && e.payDomains.length) add(pay, k, e.payDomains);
      if (sites.size) add(site, k, sites);
      if (hosts.size) add(siteHosts, k, hosts);
    }
  }
  return {
    ...registry,
    operators: registry.operators.map((o) => {
      const { payDomains: _old, siteDomains: _oldSite, siteHosts: _oldHosts, ...rest } = o;
      const p = pay.get(o.key);
      const sd = [...(site.get(o.key) ?? [])].filter((d) => !(o.domains ?? []).includes(d)).sort();
      // Hôtes sourcés des seuls siteDomains publiés (les domaines IRVE gardent leur propre règle)
      const sh = [...(siteHosts.get(o.key) ?? [])].filter((h) => sd.includes(registrableDomain(h))).sort();
      return {
        ...rest,
        ...(p ? { payDomains: [...p].sort() } : {}),
        ...(sd.length ? { siteDomains: sd } : {}),
        ...(sh.length ? { siteHosts: sh } : {}),
      };
    }),
  };
}

/**
 * Schémas iOS (LSApplicationQueriesSchemes) et paquets Android (<queries>) à déclarer pour que `Linking.canOpenURL`
 * voie les applis d'opérateurs — tirés UNIQUEMENT des appLaunch sourcés (schéma confirmé, paquet confirmé).
 * Repris par apps/mobile/app.config.ts pour ne déclarer que des cibles sourcées (jamais QUERY_ALL_PACKAGES).
 */
export function appLaunchQueries(portals) {
  const schemes = new Set();
  const packages = new Set();
  for (const e of Object.values(portals?.operators ?? {})) {
    const a = e.appLaunch;
    if (!a) continue;
    if (typeof a.scheme === 'string' && a.scheme) schemes.add(a.scheme.replace(/:\/?\/?$/, ''));
    if (typeof a.android === 'string' && a.android) packages.add(a.android);
  }
  return { schemes: [...schemes].sort(), packages: [...packages].sort() };
}

export async function readPortals(path = PORTALS_SRC) {
  const portals = JSON.parse(await readFile(path, 'utf8'));
  const errors = validatePortals(portals);
  if (errors.length) throw new Error(`operator-portals.json invalide :\n- ${errors.join('\n- ')}`);
  return portals;
}

/** Écrit operator-portals.json (payMethods compris, lus par l'app) et ajoute les payDomains au registre déjà présent dans outDir. */
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
