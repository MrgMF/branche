import { DATA_URL } from './config';

export type Plug = 'ccs' | 't2' | 'chademo' | 'ef';
export type PayMethod = 'cb' | 'sans_contact' | 'acte' | 'qr_dynamique' | 'site_web' | 'liquide' | 'badge';

/** Station telle que publiée par le pipeline (clés courtes). */
export interface Station {
  id: string;
  n: string; // nom
  a?: string; // adresse
  o?: string; // opérateur
  tel?: string;
  lat: number;
  lon: number;
  p: number; // nombre de points de charge
  kw: number; // puissance max
  c: Plug[];
  pay: PayMethod[];
  free?: boolean;
  prix?: string;
  acc?: 'reserve';
  h?: string;
  pmr?: string;
  maj?: string;
  pdc?: [string, number][];
}

export interface Meta {
  generatedAt: string;
  stations: number;
  pdc: number;
  tileSize: number;
  tiles: string[];
  license: string;
}

export const tileKey = (lat: number, lon: number, size: number) => `${Math.floor(lat / size)}_${Math.floor(lon / size)}`;

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let metaPromise: Promise<Meta> | null = null;
const tileCache = new Map<string, Promise<Station[]>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadMeta(): Promise<Meta> {
  if (!metaPromise) {
    metaPromise = getJson<Meta>(`${DATA_URL}/meta.json`).catch((e) => {
      metaPromise = null;
      throw e;
    });
  }
  return metaPromise;
}

function loadTile(key: string): Promise<Station[]> {
  let p = tileCache.get(key);
  if (!p) {
    p = getJson<{ s: Station[] }>(`${DATA_URL}/tiles/${key}.json`)
      .then((d) => d.s)
      .catch((e) => {
        tileCache.delete(key);
        throw e;
      });
    tileCache.set(key, p);
  }
  return p;
}

/** Charge les tuiles autour d'un point (anneau de `ring` tuiles). */
export async function loadAround(center: { lat: number; lon: number }, ring = 1): Promise<Station[]> {
  const meta = await loadMeta();
  const known = new Set(meta.tiles);
  const s = meta.tileSize;
  const cy = Math.floor(center.lat / s);
  const cx = Math.floor(center.lon / s);
  const keys: string[] = [];
  for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) keys.push(`${cy + dy}_${cx + dx}`);
  const lists = await Promise.all(keys.filter((k) => known.has(k)).map(loadTile));
  return lists.flat();
}

export interface Filters {
  fast: boolean;
  ccs: boolean;
  t2: boolean;
  open: boolean;
}
export const NO_FILTERS: Filters = { fast: false, ccs: false, t2: false, open: false };

export function applyFilters(list: Station[], f: Filters) {
  return list.filter(
    (s) => (!f.fast || s.kw >= 50) && (!f.ccs || s.c.includes('ccs')) && (!f.t2 || s.c.includes('t2')) && (!f.open || s.acc !== 'reserve'),
  );
}

export function nearest(list: Station[], from: { lat: number; lon: number }, count = 5) {
  return list
    .map((s) => ({ s, d: distanceKm(from, s) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count);
}

const LOOKS_LIKE_ID = /^[A-Z]{2}\*?[A-Z0-9]{3}\*?[PE][A-Z0-9*]*$|\*|\/[0-9a-f]{8,}|^[0-9a-f-]{16,}$|^FR\d{6,}$/;

/** Nom lisible : certains opérateurs publient un identifiant technique comme nom de station. */
export function displayName(s: Pick<Station, 'n' | 'o' | 'a'>): string {
  if (s.n && !LOOKS_LIKE_ID.test(s.n)) return s.n;
  const street = s.a?.split(/\d{5}/)[0]?.replace(/[,\s]+$/, '').trim();
  return [s.o, street].filter(Boolean).join(' — ') || 'Borne de recharge';
}

/** Le champ tarification contient parfois une URL plutôt qu'un prix. */
export function priceInfo(s: Pick<Station, 'prix' | 'free'>): { text: string; url?: string } {
  if (s.free) return { text: 'Gratuit' };
  const p = (s.prix ?? '').trim();
  if (!p || p === '0') return { text: 'Tarif non publié dans la base nationale — affiché sur la borne.' };
  const url = p.match(/https?:\/\/\S+/)?.[0];
  if (url && p.replace(url, '').trim().length < 4) return { text: 'Voir les tarifs de l’opérateur', url };
  return { text: p, url };
}
