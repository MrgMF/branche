// Vérification des QR codes de bornes (anti « quishing ») — fonctions pures, testées dans src/lib/qr.test.ts.

export interface Operator {
  key: string;
  names: string[];
  domains: string[];
  payUrl: string | null;
  stations?: number;
}

export type Verdict = 'official' | 'known-operator' | 'other-operator' | 'payment-platform' | 'unknown' | 'dangerous';

export interface QrResult {
  kind: 'url' | 'evse' | 'invalid';
  url?: string;
  evse?: string;
  verdict: Verdict;
  domain?: string;
  host?: string;
  operatorKey?: string;
  reasons: string[];
}

export interface VerifyOptions {
  /** Hôtes de test autorisés en http (développement uniquement). */
  devHosts?: string[];
}

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'qrco.de',
  'qr-code-generator.com', 'me-qr.com', 'linktr.ee', 'tiny.cc', 'rb.gy', 'v.gd', 's.id', 'u.to',
]);

// Plateformes de paiement en ligne reconnues, utilisées par certains opérateurs pour leur paiement ad hoc.
export const PAYMENT_PLATFORMS: Record<string, string> = {
  'stripe.com': 'Stripe',
  'sumup.com': 'SumUp',
  'payzen.eu': 'PayZen (Lyra)',
  'lyra.com': 'Lyra',
  'paypal.com': 'PayPal',
  'adyen.com': 'Adyen',
  'mollie.com': 'Mollie',
  'chargemap.com': 'Chargemap',
  'plugsurfing.com': 'Plugsurfing',
};

// Suffixes publics à deux niveaux les plus courants (domaine enregistrable).
const TWO_LEVEL = new Set(['co.uk', 'com.fr', 'gouv.fr', 'asso.fr', 'co.jp', 'com.au', 'co.nz', 'com.br', 'com.es', 'co.za']);

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}

/** Distance d'édition (Levenshtein), bornée pour rester rapide. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Identifiant de point de charge (eMI3 / AFIREV) : FR*ABC*E123… ou FRABCE123…
const EVSE_RE = /^([A-Z]{2})\*?([A-Z0-9]{3})\*?E([A-Z0-9*]{1,40})$/i;

export function normalizeEvse(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = EVSE_RE.exec(s);
  if (!m) return null;
  return `${m[1]}${m[2]}E${m[3].replace(/\*/g, '')}`;
}

const label = (d: string) => d.split('.')[0];
const lookalike = (x: string) => x.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');
const safeDecode = (x: string) => {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
};

export function verifyQr(raw: string, stationOperatorKey: string | null, operators: Operator[], opts: VerifyOptions = {}): QrResult {
  const text = (raw ?? '').trim();
  const reasons: string[] = [];
  if (!text) return { kind: 'invalid', verdict: 'dangerous', reasons: ['QR code vide.'] };

  // Identifiant de borne seul (pas d'URL)
  const evse = normalizeEvse(text);
  if (evse) return { kind: 'evse', evse, verdict: 'known-operator', reasons: ['Identifiant de point de charge reconnu.'] };

  if (/^\s*(javascript|data|file|vbscript|intent|blob):/i.test(text)) {
    return { kind: 'url', url: text, verdict: 'dangerous', reasons: ['Lien de type non autorisé (script ou donnée embarquée).'] };
  }

  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { kind: 'invalid', verdict: 'dangerous', reasons: ['Ce QR code ne contient ni lien ni identifiant de borne.'] };
  }

  const host = u.hostname.toLowerCase();
  const isDevHost = (opts.devHosts ?? []).includes(u.host.toLowerCase());
  const domain = registrableDomain(host);
  const base: QrResult = { kind: 'url', url: u.toString(), verdict: 'unknown', domain, host: u.host.toLowerCase(), reasons };

  if (u.protocol !== 'https:' && !(isDevHost && u.protocol === 'http:')) reasons.push('Le lien n’est pas sécurisé (pas de https).');
  if (u.username || u.password) reasons.push('Le lien contient des identifiants cachés.');
  if (/(^|\.)xn--/.test(host)) reasons.push('Nom de domaine à caractères trompeurs (punycode).');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) reasons.push('Adresse IP au lieu d’un nom de domaine.');
  if (SHORTENERS.has(domain) || SHORTENERS.has(host)) reasons.push('Lien raccourci : la destination réelle est masquée.');
  if (reasons.length) return { ...base, verdict: 'dangerous' };

  const owner = isDevHost ? operators.find((o) => o.domains.includes(u.host.toLowerCase())) : operators.find((o) => o.domains.includes(domain));
  const stationOp = stationOperatorKey ? operators.find((o) => o.key === stationOperatorKey) : undefined;

  if (owner) {
    if (!stationOperatorKey || owner.key === stationOperatorKey) {
      return {
        ...base,
        verdict: stationOperatorKey ? 'official' : 'known-operator',
        operatorKey: owner.key,
        reasons: [`Domaine de ${owner.names[0]} selon la base nationale IRVE.`],
      };
    }
    return {
      ...base,
      verdict: 'other-operator',
      operatorKey: owner.key,
      reasons: [`Ce QR code mène à ${owner.names[0]}, pas à l’opérateur de cette borne${stationOp ? ` (${stationOp.names[0]})` : ''}.`],
    };
  }

  // Domaine connu caché dans le sous-domaine (izivia.com.evil.site) ou dans le chemin (evil.com/izivia.com)
  const sub = host.length > domain.length ? host.slice(0, host.length - domain.length - 1) : '';
  const subLabels = sub.split('.').filter(Boolean);
  const rest = safeDecode(`${u.pathname}${u.search}`).toLowerCase();
  for (const o of operators) {
    for (const d of o.domains) {
      if (d.includes(':')) continue;
      const known = label(d);
      if (sub.includes(d) || (known.length >= 5 && subLabels.includes(known))) {
        return { ...base, verdict: 'dangerous', reasons: [`Ce lien se fait passer pour ${o.names[0]} (${d}) : le site réel est ${domain}.`] };
      }
      if (rest.includes(d)) {
        return { ...base, verdict: 'dangerous', reasons: [`Le nom de ${o.names[0]} (${d}) apparaît dans le lien, mais le site réel est ${domain}.`] };
      }
    }
  }

  const platform = PAYMENT_PLATFORMS[domain];
  if (platform) {
    return {
      ...base,
      verdict: 'payment-platform',
      reasons: [`Paiement via ${platform} : n’importe qui peut créer ce type de lien. Vérifiez que le bénéficiaire affiché est bien ${stationOp?.names[0] ?? 'l’opérateur de la borne'}.`],
    };
  }

  // Imitation d'un domaine connu : distance d'édition 1 (libellé court) ou 2 (≥ 6 caractères)
  const lbl = label(domain);
  for (const o of operators) {
    for (const d of o.domains) {
      const known = label(d);
      if (known.length < 4 || d.includes(':')) continue;
      if (domain.startsWith(`${d}.`)) {
        return { ...base, verdict: 'dangerous', reasons: [`Ce lien se fait passer pour ${o.names[0]} (${d}) : le site réel est ${domain}.`] };
      }
      if (lbl === known) {
        // Fraude documentée : même nom, autre extension (izivia.site). Les domaines secondaires réels sont déclarés dans le registre.
        return { ...base, verdict: 'dangerous', reasons: [`Ce site porte le nom de ${o.names[0]} mais n’est pas son domaine (${d}).`] };
      }
      const minLen = Math.min(known.length, lbl.length);
      if (minLen === 5 && editDistance(lbl, known, 1) <= 1) {
        return { ...base, verdict: 'unknown', reasons: [`Ce domaine ressemble à celui de ${o.names[0]} (${d}) sans l’être.`] };
      }
      // Libellés courts : seules les substitutions de caractères sosies comptent (0/o, 1/l, rn/m…)
      const close = minLen >= 6 ? editDistance(lbl, known, 2) <= 2 : lbl !== known && lookalike(lbl) === lookalike(known);
      const contains = known.length >= 5 && lbl.includes(known);
      if (close || contains) {
        return { ...base, verdict: 'dangerous', reasons: [`Ce domaine imite celui de ${o.names[0]} (${d}).`] };
      }
    }
  }
  return { ...base, verdict: 'unknown', reasons: ['Domaine absent de la base des opérateurs.'] };
}

/** URL de paiement d'un opérateur à partir de son gabarit vérifié. */
export function operatorPayUrl(op: Operator | undefined, evse: string | undefined): string | null {
  if (!op?.payUrl || !evse) return null;
  return op.payUrl.replace('{evse}', encodeURIComponent(evse));
}
