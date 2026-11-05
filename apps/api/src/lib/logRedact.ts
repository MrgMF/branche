/**
 * Les coordonnées précises ne doivent pas apparaître dans les journaux.
 * `bbox` (zone large) est conservée, arrondie à 2 décimales ; tout autre paramètre contenant
 * un nombre décimal est masqué. Les corps de requête ne sont jamais journalisés.
 */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const path = url.slice(0, q);
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(url.slice(q + 1));
  } catch {
    return `${path}?[masqué]`;
  }
  const out: string[] = [];
  for (const [k, v] of params) {
    let value: string;
    if (k === 'bbox') {
      value = v
        .split(',')
        .map((p) => {
          const n = Number(p);
          return Number.isFinite(n) && p.trim() !== '' ? n.toFixed(2) : '[masqué]';
        })
        .join(',');
    } else if (/\d\.\d|\d,\s*-?\d/.test(v)) {
      value = '[masqué]';
    } else {
      value = v.slice(0, 64);
    }
    out.push(`${encodeURIComponent(k).slice(0, 32)}=${value}`);
  }
  return `${path}?${out.join('&')}`;
}

/** Sérialiseur de requête Fastify : ni corps, ni IP, ni coordonnées. */
export const reqSerializer = (req: { method: string; url: string; routeOptions?: { url?: string } }) => ({
  method: req.method,
  url: redactUrl(req.url),
});
