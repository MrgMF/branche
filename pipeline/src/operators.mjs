// Registre des opérateurs (contrat v1.1 §1) : clé stable, noms, domaines officiels déduits de l'IRVE.

/** Messageries publiques : jamais un domaine officiel d'opérateur. */
const PUBLIC_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.com', 'live.fr',
  'msn.com', 'yahoo.com', 'yahoo.fr', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'orange.fr',
  'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'gmx.fr', 'gmx.com', 'gmx.de', 'gmx.net',
  'protonmail.com', 'proton.me', 'bbox.fr', 'numericable.fr', 'club-internet.fr', 'aliceadsl.fr', 'mail.com',
  'yandex.com', 'yandex.ru', 'zoho.com', 'web.de', 'libero.it',
]);
// Toutes extensions : gmail.*, hotmail.*, yahoo.*, gmx.*…
const PUBLIC_MAIL_LABEL = new Set(['gmail', 'googlemail', 'hotmail', 'outlook', 'live', 'msn', 'yahoo', 'ymail', 'aol', 'icloud', 'gmx', 'wanadoo', 'protonmail', 'yandex']);

/** Suffixes publics à deux niveaux (base : pas de liste PSL complète embarquée). */
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'com.fr', 'asso.fr', 'gouv.fr', 'nom.fr', 'tm.fr',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.es', 'com.pt', 'co.za', 'com.mx', 'com.tr', 'co.in', 'com.cn',
]);

export function isPublicMail(domain) {
  const d = String(domain ?? '').toLowerCase();
  if (PUBLIC_MAIL.has(d)) return true;
  const reg = registrableDomain(d);
  return !!reg && (PUBLIC_MAIL.has(reg) || PUBLIC_MAIL_LABEL.has(reg.split('.')[0]));
}

/** Ramène un hôte à son domaine enregistrable (support.izivia.com → izivia.com). null si invalide. */
export function registrableDomain(host) {
  let h = String(host ?? '').trim().toLowerCase().replace(/\.$/, '');
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0];
  if (!h || h.includes('@')) return null;
  if (/^\d+(\.\d+){3}$/.test(h) || h.includes('[')) return null; // IP littérale
  const labels = h.split('.');
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l))) return null;
  if (!/^[a-z]{2,}$/.test(labels.at(-1)) && !/^xn--/.test(labels.at(-1))) return null;
  const n = labels.length >= 3 && SECOND_LEVEL.has(labels.slice(-2).join('.')) ? 3 : 2;
  if (labels.length < n) return null;
  return labels.slice(-n).join('.');
}

/** Domaines (enregistrables, hors messageries) d'un champ contact : e-mails et URL. */
export function contactDomains(text) {
  const out = new Set();
  const s = String(text ?? '');
  for (const m of s.matchAll(/[^\s@<>"',;]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) add(out, m[1]);
  for (const host of urlHosts(s.replace(/[^\s@<>"',;]+@[a-z0-9.-]+/gi, ' '))) add(out, host);
  return [...out];
}

/** Domaines des URL d'un champ libre (tarification). */
export function urlDomains(text) {
  const out = new Set();
  for (const host of urlHosts(String(text ?? ''))) add(out, host);
  return [...out];
}

function urlHosts(s) {
  const hosts = [];
  for (const m of s.matchAll(/\bhttps?:\/\/([^\s/?#"'<>()]+)/gi)) hosts.push(m[1]);
  for (const m of s.matchAll(/(?<![\w./@-])www\.([^\s/?#"'<>()]+)/gi)) hosts.push(`www.${m[1]}`);
  return hosts;
}

function add(set, host) {
  const d = registrableDomain(host.replace(/[.,;:]+$/, ''));
  if (d && !isPublicMail(d)) set.add(d);
}

const LEGAL = new Set(['sas', 'sasu', 'sarl', 'sa', 'eurl', 'sci', 'gmbh', 'ag', 'bv', 'nv', 'srl', 'spa', 'sl', 'ltd', 'limited', 'inc', 'llc', 'plc', 'france']);

/** Segment ressemblant à un identifiant (FR*FR1, hash, uuid…). */
export function looksLikeId(seg) {
  if (seg.includes('*')) return true;
  // Suite hexadécimale : jeton (ou uuid sans tirets) de ≥ 6 caractères hexa contenant au moins un chiffre.
  return seg.split(/[^0-9a-z-]+/i).some((t) => {
    const h = t.replace(/-/g, '');
    return h.length >= 6 && /^[0-9a-f]+$/i.test(h) && /\d/.test(h);
  });
}

/** Slug d'un nom : minuscules, sans accents, sans formes juridiques ni « France ». */
export function slug(name) {
  const base = String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bb\.v\.?/g, ' bv ').replace(/\bs\.a\.s\.?/g, ' sas ').replace(/\bs\.a\.?(?=\s|$)/g, ' sa ')
    .replace(/&/g, ' ');
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  while (tokens.length > 1 && LEGAL.has(tokens.at(-1))) tokens.pop();
  while (tokens.length > 1 && LEGAL.has(tokens[0]) && tokens[0] !== 'france') tokens.shift();
  return tokens.join('-');
}

/** Premier nom propre d'un champ (segments séparés par | / ; ou « - » espacé), identifiants ignorés. */
export function properName(value) {
  for (const raw of String(value ?? '').split(/\s*[|/;]\s*|\s+-\s+/)) {
    const seg = raw.replace(/\s+/g, ' ').trim();
    if (!seg || looksLikeId(seg)) continue;
    if (slug(seg)) return seg.replace(/\s*\([^)]*\)\s*/g, ' ').trim() || seg;
  }
  return '';
}

/** Clé opérateur d'une ligne IRVE (nom_operateur, à défaut nom_enseigne, nom_amenageur). */
export function operatorKey(row) {
  for (const col of ['nom_operateur', 'nom_enseigne', 'nom_amenageur']) {
    const name = properName(row?.[col]);
    const key = slug(name);
    if (key) return { key, name };
  }
  return null;
}

export const DOMAIN_MIN_STATIONS = 3;

/** Accumule les observations par opérateur ; build() applique le seuil et produit operators.json. */
export function createOperatorRegistry({ minStations = DOMAIN_MIN_STATIONS } = {}) {
  const ops = new Map();
  const get = (key) => {
    let o = ops.get(key);
    if (!o) ops.set(key, (o = { stations: new Set(), names: new Map(), domains: new Map(), tarif: new Set() }));
    return o;
  };
  const bump = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

  /** row : ligne IRVE ; key : clé opérateur de la station ; stationKey : identifiant de station. */
  function observe(row, key, stationKey) {
    const o = get(key);
    if (!o.stations.has(stationKey)) {
      o.stations.add(stationKey);
      for (const col of ['nom_operateur', 'nom_enseigne']) {
        const n = properName(row[col]);
        if (n) bump(o.names, n);
      }
    }
    // contact_amenageur seulement si l'aménageur EST l'opérateur : sinon ce sont des domaines de clients (hôtels, parkings…).
    const cols = slug(properName(row.nom_amenageur)) === key ? ['contact_operateur', 'contact_amenageur'] : ['contact_operateur'];
    for (const col of cols) {
      for (const d of contactDomains(row[col])) {
        let set = o.domains.get(d);
        if (!set) o.domains.set(d, (set = new Set()));
        set.add(stationKey);
      }
    }
    for (const d of urlDomains(row.tarification)) o.tarif.add(d);
  }

  function build() {
    const operators = [];
    for (const [key, o] of ops) {
      // Noms : dédoublonnés sans casse/accents, les plus fréquents d'abord.
      const names = [];
      const seen = new Set();
      for (const [n, count] of [...o.names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        if (names.length && count < minStations) break; // enseignes anecdotiques (nom de ville…)
        const k = slug(n) || n.toLowerCase();
        // Doublons et déclinaisons locales (« Electra A9 », « IONITY GmbH IONITY Agde ») ignorés.
        if (seen.has(k) || [...seen].some((p) => k.startsWith(`${p}-`))) continue;
        seen.add(k);
        names.push(n);
        if (names.length >= 6) break;
      }
      const domains = new Set(o.tarif);
      for (const [d, st] of o.domains) if (st.size >= minStations) domains.add(d);
      operators.push({ key, names, domains: [...domains].sort(), payUrl: null, stations: o.stations.size });
    }
    operators.sort((a, b) => b.stations - a.stations || a.key.localeCompare(b.key));
    return { v: 1, operators };
  }

  return { observe, build };
}
