// Zones de danger (contrat v1.1 §3) : radars OSM (ODbL) + data.gouv (Licence Ouverte) → zones, JAMAIS la position du radar.
// Usage : node src/radars.mjs --out dossier [--osm fichier.json] [--gouv fichier.csv] [--min N]
// Sans --osm / --gouv : Overpass API et data.gouv.fr. Échoue (code 1, rien d'écrit) si aucune source n'est exploitable.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

export const RADIUS = { highway: 4000, urban: 500, default: 2000 };
export const OFFSET_MIN = 0.15; // fraction du rayon
export const OFFSET_MAX = 0.4;
export const DEDUPE_M = 150;
/** Deux zones « se chevauchent fortement » si leurs centres sont à moins de cette fraction du plus petit rayon. */
export const MERGE_RATIO = 0.5;
/** Écart minimal entre un centre publié et n'importe quel radar d'entrée. */
export const MIN_GAP_M = 50;

const R_EARTH = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point à `dist` mètres de `p` dans la direction `bearing` (radians, 0 = nord). */
export function destination(p, dist, bearing) {
  const d = dist / R_EARTH;
  const lat1 = rad(p.lat);
  const lon1 = rad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI + 540) % 360) - 180) };
}

/** Deux nombres pseudo-aléatoires déterministes dans [0, 1[ dérivés de (sel, id). */
export function hashUnits(id, salt = '') {
  const h = createHash('sha256').update(`${salt}\u0000${id}`).digest();
  return [h.readUInt32BE(0) / 2 ** 32, h.readUInt32BE(4) / 2 ** 32, h.readUInt32BE(8) / 2 ** 32];
}

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const num = (v) => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : NaN;
};
const validPos = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const isMotorwayRef = (s) => /^\s*A\s?\d/i.test(String(s ?? ''));

// ---------- Sources ----------

/** Requête Overpass : France métropolitaine + DOM (Guadeloupe, Martinique, Guyane, La Réunion, Mayotte). */
export const OVERPASS_QUERY = `[out:json][timeout:180];
area["ISO3166-1"~"^(FR|GP|MQ|GF|RE|YT)$"]->.fr;
node["highway"="speed_camera"](area.fr);
out body;`;

/** Réponse Overpass JSON → radars normalisés. */
export function parseOverpass(json) {
  const out = [];
  for (const el of json?.elements ?? []) {
    if (el.type !== 'node' || !validPos(el.lat, el.lon)) continue;
    const t = el.tags ?? {};
    const maxspeed = parseInt(t.maxspeed, 10);
    const highway = ['ref', 'road_ref', 'highway:ref', 'route_ref'].some((k) => isMotorwayRef(t[k])) || t.motorway === 'yes' || maxspeed >= 130;
    const urbanTag = String(t['zone:traffic'] ?? t['source:maxspeed'] ?? '').toLowerCase();
    let urban = null;
    if (urbanTag.includes('urban') && !urbanTag.includes('rural')) urban = true;
    else if (urbanTag.includes('rural')) urban = false;
    else if (Number.isFinite(maxspeed)) urban = maxspeed <= 50;
    out.push({ id: `osm:${el.id}`, lat: el.lat, lon: el.lon, highway, urban: highway ? false : urban });
  }
  return out;
}

const col = (row, ...names) => {
  for (const n of names) {
    const k = Object.keys(row).find((x) => x.trim().toLowerCase() === n);
    if (k !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
};

/** CSV data.gouv « Radars automatiques » → radars normalisés (séparateur , ou ; ; virgule décimale tolérée). */
export function parseGouvCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const header = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (header.match(/;/g) ?? []).length > (header.match(/,/g) ?? []).length ? ';' : ',';
  const rows = parse(src, { columns: true, delimiter, relax_quotes: true, relax_column_count: true, skip_empty_lines: true });
  const out = [];
  rows.forEach((row, i) => {
    const lat = num(col(row, 'latitude', 'lat'));
    const lon = num(col(row, 'longitude', 'lon', 'lng'));
    if (!validPos(lat, lon)) return;
    const route = col(row, 'route', 'voie');
    const type = col(row, 'type', 'type_radar', 'equipement').toLowerCase();
    const vl = num(col(row, 'vitesse_vehicules_legers_kmh', 'vitesse_vl', 'vitesse'));
    const emplacement = col(row, 'emplacement', 'localisation', 'agglomeration').toLowerCase();
    const highway = isMotorwayRef(route);
    let urban = null;
    if (/hors agglom/.test(emplacement)) urban = false;
    else if (/agglom/.test(emplacement)) urban = true;
    else if (/feu|urbain/.test(type) && !highway) urban = true; // feu rouge, radar urbain : agglomération
    else if (Number.isFinite(vl)) urban = vl <= 50;
    out.push({ id: `gouv:${col(row, 'id', 'identifiant', 'numero') || i}`, lat, lon, highway, urban: highway ? false : urban });
  });
  return out;
}

// ---------- Traitement ----------

/** Fusionne les radars à moins de `maxM` mètres (doublons OSM / data.gouv, ou doublons internes). */
export function dedupe(radars, maxM = DEDUPE_M) {
  const cell = 0.01; // ~1 km : couvre largement 150 m
  const grid = new Map();
  const kept = [];
  for (const r of radars) {
    const ci = Math.floor(r.lat / cell);
    const cj = Math.floor(r.lon / cell);
    let twin = null;
    for (let di = -1; di <= 1 && !twin; di++)
      for (let dj = -1; dj <= 1 && !twin; dj++)
        for (const k of grid.get(`${ci + di}_${cj + dj}`) ?? []) if (distanceM(k, r) < maxM) { twin = k; break; }
    if (twin) {
      twin.ids.push(r.id);
      twin.highway ||= r.highway;
      if (twin.urban === null) twin.urban = r.urban;
      if (twin.highway) twin.urban = false;
      continue;
    }
    const k = { ...r, ids: [r.id] };
    kept.push(k);
    const key = `${ci}_${cj}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(k);
  }
  return kept;
}

export const radiusFor = (r) => (r.highway ? RADIUS.highway : r.urban === true ? RADIUS.urban : RADIUS.default);

/** Zone d'un radar : centre décalé de façon déterministe de 15 à 40 % du rayon (la zone contient le radar). */
export function zoneFor(radar, salt = '') {
  const radiusM = radiusFor(radar);
  const [a, b] = hashUnits(radar.ids?.[0] ?? radar.id, salt);
  const dist = radiusM * (OFFSET_MIN + (OFFSET_MAX - OFFSET_MIN) * a);
  const c = destination(radar, dist, 2 * Math.PI * b);
  return { lat: c.lat, lon: c.lon, radiusM, members: [{ lat: radar.lat, lon: radar.lon }], ids: [...(radar.ids ?? [radar.id])] };
}

/** Plus petit cercle contenant deux cercles. */
function enclose(z1, z2) {
  const d = distanceM(z1, z2);
  const [big, small] = z1.radiusM >= z2.radiusM ? [z1, z2] : [z2, z1];
  if (d + small.radiusM <= big.radiusM) return { lat: big.lat, lon: big.lon, radiusM: big.radiusM };
  const radiusM = (d + z1.radiusM + z2.radiusM) / 2;
  const t = (radiusM - z1.radiusM) / d; // depuis z1 vers z2
  return { lat: z1.lat + (z2.lat - z1.lat) * t, lon: z1.lon + (z2.lon - z1.lon) * t, radiusM };
}

/** Fusionne les zones qui se chevauchent fortement ; la zone fusionnée contient les deux zones d'origine. */
export function mergeZones(zones, ratio = MERGE_RATIO) {
  let list = zones.map((z) => ({ ...z }));
  for (let changed = true; changed; ) {
    changed = false;
    const cell = 0.1; // ~11 km > 2 × rayon max
    const grid = new Map();
    list.forEach((z, i) => {
      const k = `${Math.floor(z.lat / cell)}_${Math.floor(z.lon / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const dead = new Set();
    for (let i = 0; i < list.length; i++) {
      if (dead.has(i)) continue;
      const z = list[i];
      const ci = Math.floor(z.lat / cell);
      const cj = Math.floor(z.lon / cell);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++)
          for (const j of grid.get(`${ci + di}_${cj + dj}`) ?? []) {
            if (j <= i || dead.has(j)) continue;
            const o = list[j];
            if (distanceM(list[i], o) >= ratio * Math.min(list[i].radiusM, o.radiusM)) continue;
            const e = enclose(list[i], o);
            list[i] = { ...e, members: [...list[i].members, ...o.members], ids: [...list[i].ids, ...o.ids] };
            dead.add(j);
            changed = true;
          }
    }
    list = list.filter((_, i) => !dead.has(i));
  }
  return list;
}

/** Garantit qu'aucun centre publié n'est à moins de MIN_GAP_M d'un radar, tout en contenant ses radars. */
function keepAway(zone, radars, salt) {
  const near = () => radars.some((r) => distanceM(zone, r) < MIN_GAP_M);
  for (let attempt = 0; attempt < 8 && near(); attempt++) {
    const [, , u] = hashUnits(`${zone.ids.join('|')}#${attempt}`, salt);
    const c = destination(zone, Math.max(MIN_GAP_M * 2, zone.radiusM * OFFSET_MIN), 2 * Math.PI * u);
    const need = Math.max(...zone.members.map((m) => distanceM(c, m)));
    Object.assign(zone, c, { radiusM: Math.max(zone.radiusM, Math.ceil(need + 1)) });
  }
  if (near()) throw new Error('Impossible d’éloigner un centre de zone d’un radar');
  return zone;
}

/** Radars (toutes sources) → { v:1, zones } sans aucune position de radar. */
export function buildZones(radars, { salt = '' } = {}) {
  const unique = dedupe(radars);
  const merged = mergeZones(unique.map((r) => zoneFor(r, salt)));
  const zones = merged.map((z) => {
    keepAway(z, radars, salt);
    const id = `z${createHash('sha256').update(`${salt}\u0000${[...z.ids].sort().join('|')}`).digest('hex').slice(0, 12)}`;
    // Arrondi à ~1 m vers l'extérieur : le rayon couvre l'erreur d'arrondi.
    return { id, lon: round5(z.lon), lat: round5(z.lat), radiusM: Math.ceil(z.radiusM + 2) };
  });
  zones.sort((a, b) => a.id.localeCompare(b.id));
  return { zones, stats: { radars: radars.length, unique: unique.length, zones: zones.length } };
}

// ---------- CLI ----------

const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const GOUV_URL = process.env.RADARS_URL ?? 'https://www.data.gouv.fr/api/1/datasets/r/8a22b5a8-4b65-41be-891a-7c0aead4ba51';
const UA = 'Branche-pipeline/1.0 (donnees ouvertes, zones de danger)';

async function loadOsm(file) {
  if (file) return parseOverpass(JSON.parse(await readFile(file, 'utf8')));
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: new URLSearchParams({ data: OVERPASS_QUERY }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return parseOverpass(await res.json());
}

async function loadGouv(file) {
  if (file) return parseGouvCsv(await readFile(file, 'utf8'));
  const res = await fetch(GOUV_URL, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`data.gouv HTTP ${res.status}`);
  return parseGouvCsv(await res.text());
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const outDir = resolve(arg('--out') ?? 'dist/data');
  const osmFile = arg('--osm');
  const gouvFile = arg('--gouv');
  const local = Boolean(osmFile || gouvFile);
  const min = Number(arg('--min') ?? (local ? 1 : 500));
  const salt = process.env.RADAR_SALT ?? '';
  if (!salt) console.warn('Attention : RADAR_SALT absent — décalage reproductible par quiconque connaît ce code.');

  const sources = [];
  const radars = [];
  const tasks = [
    ['OpenStreetMap (Overpass)', 'ODbL 1.0 — © contributeurs OpenStreetMap', () => loadOsm(osmFile), local && !osmFile],
    ['data.gouv.fr — Radars automatiques', 'Licence Ouverte / Open Licence 2.0', () => loadGouv(gouvFile), local && !gouvFile],
  ];
  for (const [name, license, load, skip] of tasks) {
    if (skip) continue;
    try {
      const list = await load();
      if (!list.length) throw new Error('aucun radar exploitable');
      radars.push(...list);
      sources.push({ name, license, radars: list.length });
      console.log(`${name} : ${list.length} radars`);
    } catch (e) {
      console.warn(`Source indisponible — ${name} : ${e.message}`);
    }
  }
  if (!sources.length) throw new Error('Aucune source de radars disponible : rien n’est publié.');

  const { zones, stats } = buildZones(radars, { salt });
  if (zones.length < min) throw new Error(`Trop peu de zones (${zones.length} < ${min}) : rien n’est publié.`);
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, 'danger-zones.json');
  await writeFile(`${file}.tmp`, JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), sources, zones }));
  await rename(`${file}.tmp`, file);
  console.log(`OK : ${stats.radars} radars, ${stats.unique} après dédoublonnage, ${stats.zones} zones → ${file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`Échec zones de danger : ${e.message}`);
    process.exit(1);
  });
}
