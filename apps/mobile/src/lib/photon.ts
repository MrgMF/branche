// Repli de recherche côté app quand l'API Branché n'est pas configurée (site statique) : Photon (komoot, données OSM).
import type { Place, SearchResponse } from './navigation';

const URL_PHOTON = 'https://photon.komoot.io/api/';
const ZONES = [
  { s: 41.0, n: 51.6, w: -6.0, e: 10.0 },
  { s: 14.0, n: 18.5, w: -63.5, e: -60.5 },
  { s: 1.8, n: 6.2, w: -55.0, e: -51.2 },
  { s: -21.6, n: -20.7, w: 55.0, e: 56.0 },
  { s: -13.2, n: -12.4, w: 44.8, e: 45.5 },
];
const COUNTRIES = ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'];
const inZone = (p: { lat: number; lon: number }) => ZONES.find((z) => p.lat >= z.s && p.lat <= z.n && p.lon >= z.w && p.lon <= z.e);
const txt = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, 120) : '');
const join = (...a: string[]) => a.filter(Boolean).join(' ');

type Feature = { geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> };

export function parsePhotonClient(body: unknown): Place[] {
  const feats = (body as { features?: Feature[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const c = f.geometry?.coordinates;
    const lon = Array.isArray(c) && typeof c[0] === 'number' ? c[0] : null;
    const lat = Array.isArray(c) && typeof c[1] === 'number' ? c[1] : null;
    const pr = f.properties ?? {};
    const cc = txt(pr.countrycode).toUpperCase();
    if (lat === null || lon === null || !inZone({ lat, lon }) || (cc && !COUNTRIES.includes(cc))) continue;
    const name = txt(pr.name);
    const street = txt(pr.street);
    const hn = txt(pr.housenumber);
    const city = join(txt(pr.postcode), txt(pr.city) || txt(pr.county));
    const t = txt(pr.type);
    let p: Omit<Place, 'lat' | 'lon'>;
    if (t === 'house' && street && (hn || !name)) p = { label: join(hn, street), sublabel: city, kind: 'address' };
    else if (t === 'street') p = { label: name || street, sublabel: city, kind: 'street' };
    else if (['city', 'district', 'locality', 'county', 'state'].includes(t)) p = { label: name, sublabel: join(txt(pr.postcode), txt(pr.state)), kind: 'city' };
    else p = { label: name || join(hn, street), sublabel: name && street ? `${join(hn, street)}, ${city}` : city, kind: 'poi' };
    const k = `${p.label}|${p.sublabel}`.toLowerCase();
    if (!p.label || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...p, lat, lon });
  }
  return out.slice(0, 8);
}

export async function searchPhoton(q: string, near: { lat: number; lon: number } | null | undefined, signal?: AbortSignal): Promise<SearchResponse> {
  const z = (near && inZone(near)) || ZONES[0];
  const qs = new URLSearchParams({ q, lang: 'fr', limit: '12', bbox: `${z.w},${z.s},${z.e},${z.n}` });
  if (near) {
    qs.set('lat', near.lat.toFixed(3));
    qs.set('lon', near.lon.toFixed(3));
  }
  let res: Response;
  try {
    res = await fetch(`${URL_PHOTON}?${qs}`, { signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new Error('Recherche indisponible. Vérifiez votre connexion.');
  }
  if (!res.ok) throw new Error('Recherche indisponible pour le moment.');
  return { provider: 'photon', attribution: '© contributeurs OpenStreetMap, Photon (komoot)', results: parsePhotonClient(await res.json().catch(() => null)) };
}
