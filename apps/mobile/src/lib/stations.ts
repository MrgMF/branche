import { DATA_URL } from './config';
import { tr } from '../i18n';
import { freeCredible } from './tariff';

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
  pdc?: [string, number, Plug[]?][]; // [id_pdc_itinerance, kW, prises du point (V2)]
  ok?: string; // clé opérateur (registre)
  cab?: boolean; // câble Type 2 attaché sur au moins un point
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
  const op = s.o?.split('|').map((x) => x.trim()).find((x) => x && !x.includes('*'));
  return [op, street].filter(Boolean).join(' — ') || tr().common.stationFallback;
}

const SMALL_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'sur', 'sous', 'au', 'aux', 'à', 'd', 'l']);
/**
 * Nom saisi tout en capitales (IRVE brut : « L'HAY LES ROSES ») → casse de titre (« L'Hay les Roses ») ; un nom déjà en
 * minuscules/majuscules mêlées est gardé tel quel. Sigles sans voyelle (« SDE », « ZI ») conservés.
 */
export function tidyCaps(n: string): string {
  if (/\p{Ll}/u.test(n) || !/\p{Lu}{3}/u.test(n)) return n;
  let first = true;
  return n.replace(/\p{L}+/gu, (w) => {
    const lw = w.toLowerCase();
    const isFirst = first;
    first = false;
    if (!isFirst && SMALL_WORDS.has(lw)) return lw;
    if (w.length <= 4 && !/[aeiouyàâäéèêëïîôöùûüÿ]/i.test(w)) return w;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  });
}

/** Nom d'une borne pour le guidage (bandeau, voix, partage) : jamais le nom IRVE brut en capitales. */
export const navName = (s: Pick<Station, 'n' | 'o' | 'a'>): string => tidyCaps(displayName(s));

/** Le champ tarification contient parfois une URL plutôt qu'un prix. */
export function priceInfo(s: Pick<Station, 'prix' | 'free' | 'kw' | 'pay'>): { text: string; url?: string } {
  if (s.free) return { text: freeCredible(s) ? tr().station.free : tr().tariff.freeDoubtful };
  const p = (s.prix ?? '').trim();
  if (!p || p === '0') return { text: tr().pricing.unpublished };
  const url = p.match(/https?:\/\/\S+/)?.[0];
  if (url && p.replace(url, '').trim().length < 4) return { text: tr().pricing.seeOperator, url };
  return { text: p, url };
}

import type { Operator } from './qr';
let opsPromise: Promise<Operator[]> | null = null;
/** Registre des opérateurs (domaines officiels, gabarits de paiement). */
export function loadOperators(): Promise<Operator[]> {
  if (!opsPromise) {
    opsPromise = getJson<{ operators: Operator[] }>(`${DATA_URL}/operators.json`)
      .then((d) => d.operators)
      .catch(() => {
        opsPromise = null;
        return [];
      });
  }
  return opsPromise;
}

/** Retrouve une station chargée à partir d'un identifiant de point de charge (normalisé, sans *). */
export function findByEvse(list: Station[], evse: string): Station | undefined {
  const norm = (x: string) => x.toUpperCase().replace(/\*/g, '');
  const target = norm(evse);
  return list.find((s) => s.pdc?.some(([id]) => norm(id) === target) || norm(s.id) === target);
}
