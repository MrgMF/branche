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
  /**
   * Hôtes exacts des URL sourcées sur ces siteDomains (support.alizecharge.com…), publiés par le pipeline : seuls eux
   * valent « Site officiel » ; un autre sous-domaine du même site (pay.alizecharge.com) demande une confirmation.
   */
  siteHosts?: string[];
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
  /**
   * Voie proposée à la place d'un lien bloqué : page officielle connue, lecteur CB déclaré, ou (lien entre
   * particuliers sans voie officielle connue ici) la borne payable la plus proche.
   */
  alternative?: 'page' | 'reader' | 'nearest';
}

export interface VerifyOptions {
  /** Hôtes de test autorisés en http (développement uniquement). */
  devHosts?: string[];
  /**
   * Voies officielles de la borne (methods.ts payOptions) : page de paiement connue de l'opérateur, lecteur CB déclaré.
   * Un lien Stripe/SumUp y est alors bloqué et la voie officielle proposée.
   */
  official?: { page?: boolean; reader?: boolean };
}

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'qrco.de',
  'qr-code-generator.com', 'me-qr.com', 'linktr.ee', 'tiny.cc', 'rb.gy', 'v.gd', 's.id', 'u.to',
  // Liens de partage et de redirection : la destination réelle est masquée comme avec un raccourcisseur
  't.me', 'lnkd.in', 't.ly', 'bit.do', 'surl.li', 'urlz.fr', 'cutt.us', 'tr.ee', 'urldefense.com',
  // Générateurs de QR codes dynamiques et raccourcisseurs (destination modifiable à tout moment)
  'qrfy.io', 'qr1.be', 'l.ead.me', 'scan.page', 'qrs.ly', 'short.io',
  // Liens dynamiques Firebase (*.page.link) et Branch (*.app.link) : redirection vers une destination masquée
  'page.link', 'app.link',
  // Anonymiseur de référent : redirige vers l'adresse passée après « ? »
  'href.li',
]);
/** Redirecteurs hébergés sur un grand domaine (hôte exact ou suffixe) : traités comme des raccourcisseurs. */
const REDIRECT_HOSTS = ['l.facebook.com', 'lm.facebook.com', 'l.instagram.com', 'l.messenger.com', 'l.wl.co', 'out.reddit.com', 'safelinks.protection.outlook.com', 'urldefense.proofpoint.com'];
/** Redirecteur masqué : raccourcisseur, hôte de redirection, ou chemin de redirection (google.xx/url, youtube.com/redirect). */
export function isRedirector(host: string, path: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const d = registrableDomain(h);
  if (SHORTENERS.has(d) || SHORTENERS.has(h)) return true;
  if (REDIRECT_HOSTS.some((x) => h === x || h.endsWith(`.${x}`))) return true;
  // google.xx/url et google.xx/amp/s/<page> (AMP : affiche une page d'un autre site sous l'adresse Google)
  if (/^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h) && (/^\/url\/?$/i.test(path) || /^\/amp\/s\//i.test(path))) return true;
  // bing.com/ck/a : lien de suivi des résultats Bing, redirige vers la page cible
  if (/(^|\.)bing\.com$/.test(h) && /^\/ck\/a\/?$/i.test(path)) return true;
  return /(^|\.)youtube\.com$/.test(h) && /^\/redirect\/?$/i.test(path);
}

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

/**
 * Liens de paiement entre particuliers : aucun opérateur de recharge n'encaisse ainsi (argent envoyé à une personne,
 * sans recours) → toujours bloqués. Domaines entiers, hôtes précis, et chemins PayPal.me hébergés sur paypal.com.
 */
const P2P_DOMAINS: Record<string, string> = {
  'paypal.me': 'PayPal.me',
  'lydia-app.com': 'Lydia',
  // pay.lydia.me, lien.lydia.me : liens de paiement Lydia (particuliers)
  'lydia.me': 'Lydia',
  'revolut.me': 'Revolut',
  'sumup.me': 'SumUp (lien personnel)',
  'sumup.link': 'SumUp (lien de paiement)',
  'mollie.me': 'Mollie (lien de paiement)',
  'monzo.me': 'Monzo',
  // Cagnottes en ligne : l'argent va à l'organisateur de la cagnotte
  'leetchi.com': 'Leetchi',
};
const P2P_HOSTS: Record<string, string> = { 'checkout.revolut.com': 'Revolut' };
export function p2pPlatform(host: string, path: string): string | null {
  const h = host.toLowerCase().replace(/^www\./, '');
  const d = registrableDomain(h);
  if (P2P_DOMAINS[d]) return P2P_DOMAINS[d];
  if (P2P_HOSTS[h]) return P2P_HOSTS[h];
  if (d === 'paypal.com' && /^\/paypalme(\/|$)/i.test(path)) return 'PayPal.me';
  // wise.com/pay/me/<nom> : lien de paiement personnel Wise (le reste de wise.com n'est pas concerné)
  if (d === 'wise.com' && /^\/pay\/me(\/|$)/i.test(path)) return 'Wise';
  return null;
}

/**
 * Liens de paiement que n'importe qui crée en quelques minutes (Stripe Payment Links, SumUp) : bloqués sur une borne
 * dont l'opérateur a une page officielle connue ou un lecteur CB déclaré (voie proposée à la place).
 */
const SELF_SERVE_LINKS = new Set(['stripe.com', 'sumup.com']);

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
  if (isRedirector(host, u.pathname)) reasons.push(tr().qr.shortener);
  if (reasons.length) return { ...base, verdict: 'dangerous' };

  const stationOp = stationOperatorKey ? operators.find((o) => o.key === stationOperatorKey) : undefined;
  // Voies officielles de la borne : page de paiement connue (gabarit ou page sourcée de son opérateur), lecteur CB déclaré
  const officialPage = !!opts.official?.page || !!stationOp?.payUrl || !!stationOp?.payDomains?.length;
  const officialReader = !!opts.official?.reader;

  // Lien entre particuliers : toujours bloqué, avec la voie officielle de la borne (ou la borne payable la plus proche)
  const p2p = p2pPlatform(host, u.pathname);
  if (p2p) {
    const alternative = officialPage ? 'page' : officialReader ? 'reader' : 'nearest';
    return { ...base, verdict: 'dangerous', alternative, reasons: [tr().qr.p2p(p2p, stationOp?.names[0] ?? null, alternative)] };
  }
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
      // Site sourcé : « Site officiel » seulement sur un hôte exact des sources ; autre sous-domaine → confirmation
      const sourcedHost = irve || (owner.siteHosts ?? []).includes(host.replace(/^www\./, ''));
      if (!sourcedHost) {
        return { ...base, verdict: 'unknown', operatorKey: owner.key, source: 'site', reasons: [tr().qr.siteUnsourced(owner.names[0], domain)] };
      }
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
  if (platform && SELF_SERVE_LINKS.has(domain)) {
    // Page officielle connue (gabarit ou page sourcée de l'opérateur de la borne) ou lecteur CB déclaré : lien bloqué
    const page = officialPage;
    const reader = officialReader;
    if (page || reader) {
      return {
        ...base,
        verdict: 'dangerous',
        alternative: page ? 'page' : 'reader',
        reasons: [tr().qr.platformBlocked(platform, stationOp?.names[0] ?? null, page ? 'page' : 'reader')],
      };
    }
  }
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
