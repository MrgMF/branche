// Vérification des QR codes de bornes (anti « quishing ») — fonctions pures, testées dans src/lib/qr.test.ts.
import { tr } from '../i18n';

export interface Operator {
  key: string;
  names: string[];
  domains: string[];
  payUrl: string | null;
  stations?: number;
  /** Hôtes des pages de paiement/démarrage officielles (operator-portals.json, URL sourcées), publiés par le pipeline. */
  payDomains?: string[];
  /**
   * Domaines enregistrables des sites de l'opérateur présents dans ses URL sourcées (alizecharge.com, reveocharge.com…),
   * hors sites tiers (presse, forums) : domaines connus de l'opérateur, jamais traités comme des sosies.
   */
  siteDomains?: string[];
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
  /**
   * D'où vient la confiance : domaine déclaré dans l'IRVE, page de paiement officielle sourcée (payDomains),
   * ou site officiel de l'opérateur présent dans ses sources (siteDomains).
   */
  source?: 'irve' | 'portal' | 'site';
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
  if (!text) return { kind: 'invalid', verdict: 'dangerous', reasons: [tr().qr.empty] };

  // Identifiant de borne seul (pas d'URL)
  const evse = normalizeEvse(text);
  if (evse) return { kind: 'evse', evse, verdict: 'known-operator', reasons: [tr().qr.evse] };

  if (/^\s*(javascript|data|file|vbscript|intent|blob):/i.test(text)) {
    return { kind: 'url', url: text, verdict: 'dangerous', reasons: [tr().qr.scheme] };
  }

  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { kind: 'invalid', verdict: 'dangerous', reasons: [tr().qr.notQr] };
  }

  const host = u.hostname.toLowerCase();
  const isDevHost = (opts.devHosts ?? []).includes(u.host.toLowerCase());
  const domain = registrableDomain(host);
  const base: QrResult = { kind: 'url', url: u.toString(), verdict: 'unknown', domain, host: u.host.toLowerCase(), reasons };

  if (u.protocol !== 'https:' && !(isDevHost && u.protocol === 'http:')) reasons.push(tr().qr.http);
  if (u.username || u.password) reasons.push(tr().qr.creds);
  if (/(^|\.)xn--/.test(host)) reasons.push(tr().qr.punycode);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) reasons.push(tr().qr.ip);
  if (SHORTENERS.has(domain) || SHORTENERS.has(host)) reasons.push(tr().qr.shortener);
  if (reasons.length) return { ...base, verdict: 'dangerous' };

  const stationOp = stationOperatorKey ? operators.find((o) => o.key === stationOperatorKey) : undefined;
  const hostKey = isDevHost ? u.host.toLowerCase() : host;

  // 1. Page de paiement officielle sourcée (payDomains) : celle de l'opérateur de la borne d'abord
  const onPay = (o: Operator) => (o.payDomains ?? []).some((d) => hostKey === d || hostKey.endsWith(`.${d}`));
  const payOwner = stationOp && onPay(stationOp) ? stationOp : operators.find(onPay);
  if (payOwner) {
    const mine = !!stationOp && payOwner.key === stationOp.key;
    return {
      ...base,
      verdict: mine ? 'official' : 'known-operator',
      operatorKey: payOwner.key,
      source: 'portal',
      reasons: [mine || !stationOp ? tr().qr.officialPay(payOwner.names[0]) : tr().qr.otherPay(payOwner.names[0], stationOp.names[0])],
    };
  }

  // 2. Domaine déclaré dans la base IRVE, ou site officiel sourcé (celui de l'opérateur de la borne d'abord : réseaux
  // partageant un domaine)
  const irveOwns = (o: Operator) => (isDevHost ? o.domains.includes(u.host.toLowerCase()) : o.domains.includes(domain));
  const owns = (o: Operator) => irveOwns(o) || (!isDevHost && (o.siteDomains ?? []).includes(domain));
  const owner = stationOp && owns(stationOp) ? stationOp : operators.find(owns);

  if (owner) {
    if (!stationOperatorKey || owner.key === stationOperatorKey) {
      const irve = irveOwns(owner);
      return {
        ...base,
        verdict: stationOperatorKey ? 'official' : 'known-operator',
        operatorKey: owner.key,
        source: irve ? 'irve' : 'site',
        reasons: [irve ? tr().qr.official(owner.names[0]) : tr().qr.officialSite(owner.names[0])],
      };
    }
    return {
      ...base,
      verdict: 'other-operator',
      operatorKey: owner.key,
      reasons: [tr().qr.otherOp(owner.names[0], stationOp?.names[0] ?? null)],
    };
  }

  // Domaines enregistrables des pages officielles (wa.qwello.eu → qwello.eu) : jamais traités comme des sosies
  // (autre page du même site : « non vérifié », pas « bloqué »). Ils servent aussi de référence anti-sosie (qwe11o.eu, xfm.fr.evil.site…).
  const trusted = operators.some((o) => (o.payDomains ?? []).some((d) => registrableDomain(d) === domain));
  const known = (o: Operator) => [...o.domains, ...(o.siteDomains ?? []), ...(o.payDomains ?? []).map(registrableDomain)];

  // Domaine connu caché dans le sous-domaine (izivia.com.evil.site) ou dans le chemin (evil.com/izivia.com)
  const sub = host.length > domain.length ? host.slice(0, host.length - domain.length - 1) : '';
  const subLabels = sub.split('.').filter(Boolean);
  const rest = safeDecode(`${u.pathname}${u.search}`).toLowerCase();
  for (const o of operators) {
    for (const d of known(o)) {
      if (d.includes(':')) continue;
      const lbl0 = label(d);
      if (!trusted && (sub.includes(d) || (lbl0.length >= 5 && subLabels.includes(lbl0)))) {
        return { ...base, verdict: 'dangerous', reasons: [tr().qr.impersonate(o.names[0], d, domain)] };
      }
      if (rest.includes(d)) {
        return { ...base, verdict: 'dangerous', reasons: [tr().qr.nameInLink(o.names[0], d, domain)] };
      }
    }
  }

  const platform = PAYMENT_PLATFORMS[domain];
  if (platform) {
    return {
      ...base,
      verdict: 'payment-platform',
      reasons: [tr().qr.platform(platform, stationOp?.names[0] ?? null)],
    };
  }

  // Imitation d'un domaine connu : distance d'édition 1 (libellé court) ou 2 (≥ 6 caractères)
  const lbl = label(domain);
  for (const o of trusted ? [] : operators) {
    for (const d of known(o)) {
      const ref = label(d);
      if (ref.length < 4 || d.includes(':')) continue;
      if (domain.startsWith(`${d}.`)) {
        return { ...base, verdict: 'dangerous', reasons: [tr().qr.impersonate(o.names[0], d, domain)] };
      }
      if (lbl === ref) {
        // Fraude documentée : même nom, autre extension (izivia.site). Les domaines secondaires réels sont déclarés dans le registre.
        return { ...base, verdict: 'dangerous', reasons: [tr().qr.nameNotDomain(o.names[0], d)] };
      }
      const minLen = Math.min(ref.length, lbl.length);
      if (minLen === 5 && editDistance(lbl, ref, 1) <= 1) {
        return { ...base, verdict: 'unknown', reasons: [tr().qr.lookalike(o.names[0], d)] };
      }
      // Libellés courts : seules les substitutions de caractères sosies comptent (0/o, 1/l, rn/m…)
      const close = minLen >= 6 ? editDistance(lbl, ref, 2) <= 2 : lbl !== ref && lookalike(lbl) === lookalike(ref);
      const contains = ref.length >= 5 && lbl.includes(ref);
      if (close || contains) {
        return { ...base, verdict: 'dangerous', reasons: [tr().qr.imitates(o.names[0], d)] };
      }
    }
  }
  return { ...base, verdict: 'unknown', reasons: [tr().qr.unknownDomain] };
}

/** URL de paiement d'un opérateur à partir de son gabarit vérifié. */
export function operatorPayUrl(op: Operator | undefined, evse: string | undefined): string | null {
  if (!op?.payUrl || !evse) return null;
  return op.payUrl.replace('{evse}', encodeURIComponent(evse));
}
