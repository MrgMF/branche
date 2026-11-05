/**
 * Validation stricte des URL de retour (anti open-redirect).
 * Un préfixe autorisé peut contenir « * » pour UN label DNS (ex. https://*.github.io).
 * Si le préfixe se termine par un hôte (pas par « / » ni « :// »), le caractère suivant
 * doit être une frontière (« / », « : », « ? », « # » ou fin) : http://localhost.evil.com est refusé.
 */
const MAX_LEN = 2048;

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

// IPv4 privée (10/8, 172.16/12, 192.168/16, 127/8), port facultatif, puis fin de l'autorité.
const PRIVATE_IP = String.raw`(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})`;
const EXPO_LAN = new RegExp(`^exps?://${PRIVATE_IP}(?::\\d{1,5})?(?=$|[/?#])`, 'i');

function prefixToRegex(prefix: string): RegExp {
  if (prefix === 'exp://LAN') return EXPO_LAN;
  const body = prefix
    .split('*')
    .map(escapeRegex)
    .join('[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?');
  const needsBoundary = !(prefix.endsWith('/') || prefix.endsWith('://'));
  return new RegExp(`^${body}${needsBoundary ? '(?=$|[/:?#])' : ''}`, 'i');
}

export function createReturnUrlValidator(prefixes: string[]): (url: string) => boolean {
  const regexes = prefixes.map(prefixToRegex);
  return (url: string) => {
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_LEN) return false;
    // Pas d'espaces, de caractères de contrôle ni d'antislash (contournements classiques).
    if (/[\s\\\u0000-\u001f\u007f]/.test(url)) return false;
    // Pas d'identifiants dans l'autorité (http://localhost:80@evil.com → hôte evil.com).
    const auth = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url);
    if (auth?.[1]?.includes('@')) return false;
    return regexes.some((r) => r.test(url));
  };
}

/** Ajoute des paramètres de requête sans normaliser l'URL (schémas personnalisés compris). */
export function withQuery(url: string, params: Record<string, string>): string {
  const hashIdx = url.indexOf('#');
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const qs = new URLSearchParams(params).toString();
  const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${sep}${qs}${hash}`;
}
