// Recherche d'adresse / de lieu : TomTom Search (fuzzy) si clé, sinon Photon (komoot, données OSM).
// Aucun cache (conditions TomTom ; et la saisie est une donnée personnelle), aucune requête journalisée.
import { fetchWithTimeout, type FetchLike } from '../lib/ttlCache.js';
import { round, ZONES, zoneOf, type LatLon } from '../lib/geo.js';

export interface Place {
  /** Ligne principale : nom du lieu, ou « numéro rue ». */
  label: string;
  /** Ligne secondaire : code postal et commune, ou région. */
  sublabel: string;
  lat: number;
  lon: number;
  kind: 'address' | 'street' | 'poi' | 'city';
}

export interface SearchResult {
  provider: 'tomtom' | 'photon';
  attribution: string;
  results: Place[];
}

export interface SearchProvider {
  readonly name: SearchResult['provider'];
  search(q: string, near?: LatLon): Promise<SearchResult>;
}

export class SearchProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
  ) {
    super(`${provider}: ${reason}`);
    this.name = 'SearchProviderError';
  }
}

export const MAX_RESULTS = 8;
const TIMEOUT_MS = 6000;
const USER_AGENT = 'branche-api/2.0 (+https://github.com/branche)';
/** Codes pays couverts : métropole + DROM (TomTom les traite comme des pays distincts). */
export const COUNTRIES = ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const text = (x: unknown) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '');
const join = (...parts: string[]) => parts.filter(Boolean).join(' ');

async function getJson(provider: string, fetchFn: FetchLike, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchFn, url, { method: 'GET', headers: { 'user-agent': USER_AGENT, accept: 'application/json' } }, TIMEOUT_MS);
  } catch (err) {
    throw new SearchProviderError(provider, err instanceof Error && err.name === 'AbortError' ? 'délai dépassé' : 'injoignable');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new SearchProviderError(provider, `HTTP ${res.status}`);
  }
  const raw = await res.text();
  if (raw.length > 2_000_000) throw new SearchProviderError(provider, 'réponse trop volumineuse');
  try {
    return JSON.parse(raw);
  } catch {
    throw new SearchProviderError(provider, 'réponse non JSON');
  }
}

function dedupe(list: Place[]): Place[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = `${p.label.toLowerCase()}|${p.sublabel.toLowerCase()}`;
    if (seen.has(k) || !zoneOf(p)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- TomTom Search (fuzzy)

/** Réponse TomTom Fuzzy Search → lieux. Exportée pour les tests. */
export function parseTomTomSearch(body: unknown): Place[] {
  if (!isObj(body) || !Array.isArray(body.results)) return [];
  const out: Place[] = [];
  for (const r of body.results.filter(isObj)) {
    const pos = isObj(r.position) ? r.position : null;
    const lat = pos ? num(pos.lat) : null;
    const lon = pos ? num(pos.lon) : null;
    if (lat === null || lon === null) continue;
    const a = isObj(r.address) ? r.address : {};
    const city = join(text(a.postalCode), text(a.municipality));
    const street = text(a.streetName);
    const type = r.type;
    let p: Omit<Place, 'lat' | 'lon'> | null = null;
    if (type === 'POI') {
      const name = isObj(r.poi) ? text(r.poi.name) : '';
      p = { label: name || text(a.freeformAddress), sublabel: text(a.freeformAddress) || city, kind: 'poi' };
    } else if (type === 'Point Address' || type === 'Address Range') {
      p = { label: join(text(a.streetNumber), street) || text(a.freeformAddress), sublabel: city, kind: 'address' };
    } else if (type === 'Street' || type === 'Cross Street') {
      p = { label: street || text(a.freeformAddress), sublabel: city, kind: 'street' };
    } else if (type === 'Geography') {
      p = { label: text(a.municipality) || text(a.freeformAddress), sublabel: text(a.countrySubdivision) || text(a.country), kind: 'city' };
    }
    if (p && p.label) out.push({ ...p, lat: round(lat, 6), lon: round(lon, 6) });
  }
  return dedupe(out).slice(0, MAX_RESULTS);
}

export class TomTomSearchProvider implements SearchProvider {
  readonly name = 'tomtom' as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike,
    private readonly baseUrl = 'https://api.tomtom.com',
  ) {}

  buildUrl(q: string, near?: LatLon): string {
    const qs = new URLSearchParams({
      key: this.apiKey,
      countrySet: COUNTRIES.join(','),
      language: 'fr-FR',
      limit: String(MAX_RESULTS),
      typeahead: 'true',
    });
    if (near) {
      qs.set('lat', String(round(near.lat, 3)));
      qs.set('lon', String(round(near.lon, 3)));
    }
    return `${this.baseUrl}/search/2/search/${encodeURIComponent(q)}.json?${qs}`;
  }

  async search(q: string, near?: LatLon): Promise<SearchResult> {
    const body = await getJson('tomtom', this.fetchFn, this.buildUrl(q, near));
    return { provider: 'tomtom', attribution: '© TomTom', results: parseTomTomSearch(body) };
  }
}

// ---------------------------------------------------------------- Photon (komoot)

const PHOTON_COUNTRIES = new Set(COUNTRIES);

/** Réponse Photon (GeoJSON) → lieux. Exportée pour les tests. */
export function parsePhoton(body: unknown): Place[] {
  if (!isObj(body) || !Array.isArray(body.features)) return [];
  const out: Place[] = [];
  for (const f of body.features.filter(isObj)) {
    const g = isObj(f.geometry) ? f.geometry : null;
    const c = g && Array.isArray(g.coordinates) ? g.coordinates : null;
    const lon = c ? num(c[0]) : null;
    const lat = c ? num(c[1]) : null;
    const pr = isObj(f.properties) ? f.properties : null;
    if (lat === null || lon === null || !pr) continue;
    const cc = text(pr.countrycode).toUpperCase();
    if (cc && !PHOTON_COUNTRIES.has(cc)) continue;
    const name = text(pr.name);
    const street = text(pr.street);
    const hn = text(pr.housenumber);
    const city = join(text(pr.postcode), text(pr.city) || text(pr.county));
    const t = text(pr.type);
    let p: Omit<Place, 'lat' | 'lon'>;
    if (t === 'house' && street && (hn || !name)) p = { label: join(hn, street), sublabel: name && name !== street ? join(name, '·', city) : city, kind: 'address' };
    else if (t === 'street') p = { label: name || street, sublabel: city, kind: 'street' };
    else if (t === 'city' || t === 'district' || t === 'locality' || t === 'county' || t === 'state') {
      p = { label: name, sublabel: join(text(pr.postcode), text(pr.state)) || text(pr.country), kind: 'city' };
    } else p = { label: name || join(hn, street), sublabel: name && street ? `${join(hn, street)}, ${city}` : city, kind: 'poi' };
    if (p.label) out.push({ ...p, lat: round(lat, 6), lon: round(lon, 6) });
  }
  return dedupe(out).slice(0, MAX_RESULTS);
}

export class PhotonSearchProvider implements SearchProvider {
  readonly name = 'photon' as const;
  constructor(
    private readonly url: string,
    private readonly fetchFn: FetchLike,
  ) {}

  buildUrl(q: string, near?: LatLon): string {
    const zone = (near && ZONES.find((z) => z.id === zoneOf(near))) ?? ZONES[0];
    const qs = new URLSearchParams({ q, lang: 'fr', limit: String(MAX_RESULTS + 4), bbox: `${zone.w},${zone.s},${zone.e},${zone.n}` });
    if (near) {
      qs.set('lat', String(round(near.lat, 3)));
      qs.set('lon', String(round(near.lon, 3)));
    }
    return `${this.url}?${qs}`;
  }

  async search(q: string, near?: LatLon): Promise<SearchResult> {
    const body = await getJson('photon', this.fetchFn, this.buildUrl(q, near));
    return { provider: 'photon', attribution: '© contributeurs OpenStreetMap, Photon (komoot)', results: parsePhoton(body) };
  }
}

export function buildSearch(config: { tomtomApiKey: string | null; photonUrl: string | null }, fetchFn: FetchLike): SearchProvider | null {
  if (config.tomtomApiKey) return new TomTomSearchProvider(config.tomtomApiKey, fetchFn);
  if (config.photonUrl) return new PhotonSearchProvider(config.photonUrl, fetchFn);
  return null;
}
