// Transforme les lignes IRVE (un point de charge par ligne) en stations compactes.
// Compatible schéma consolidé v2.3.x et schéma statique récent (noms de colonnes alternatifs).

import { createOperatorRegistry, operatorKey } from './operators.mjs';

export const TILE_SIZE = 0.25; // degrés
export const MAX_PDC = 24; // points détaillés par station dans les tuiles
export const EVSE_BUCKETS = 256;

const first = (row, ...keys) => {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

export const bool = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'vrai' || s === 'oui' || s === 't';
};

const num = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return NaN;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export function coords(row) {
  let lat = num(first(row, 'consolidated_latitude', 'station_latitude'));
  let lon = num(first(row, 'consolidated_longitude', 'station_longitude'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const m = first(row, 'coordonneesXY').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) { lon = Number(m[1]); lat = Number(m[2]); }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
}

export function powerKw(row) {
  let p = num(first(row, 'puissance_nominale', 'puissance_nominale_kw'));
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p > 2000) p = p / 1000; // valeurs saisies en W
  return Math.round(p * 10) / 10;
}

function adHocMethods(row) {
  const raw = first(row, 'paiement_ad_hoc');
  const methods = new Set();
  if (raw) for (const m of ['qr_dynamique', 'site_web', 'liquide']) if (raw.includes(m)) methods.add(m);
  return methods;
}

export const tileKey = (lat, lon) => `${Math.floor(lat / TILE_SIZE)}_${Math.floor(lon / TILE_SIZE)}`;

const clean = (s, max = 120) => s.replace(/\s+/g, ' ').slice(0, max);

/** Agrège un flux de lignes en Map<stationKey, station>. */
export function createAggregator() {
  const stations = new Map();
  const operators = createOperatorRegistry();
  const seenPdc = new Set();
  let rows = 0;
  let skipped = 0;

  function add(row) {
    rows++;
    const c = coords(row);
    if (!c) { skipped++; return; }
    const pdcId = first(row, 'id_pdc_itinerance', 'id_pdc_local');
    if (pdcId) {
      if (seenPdc.has(pdcId)) return;
      seenPdc.add(pdcId);
    }
    const stationId = first(row, 'id_station_itinerance', 'id_station_local');
    const key = stationId || `${c.lat.toFixed(4)},${c.lon.toFixed(4)}|${first(row, 'nom_station')}`;
    let s = stations.get(key);
    if (!s) {
      s = {
        id: stationId || key,
        n: clean(first(row, 'nom_station', 'nom_enseigne') || 'Station de recharge', 80),
        a: clean(first(row, 'adresse_station'), 140),
        o: clean(first(row, 'nom_operateur', 'nom_enseigne', 'nom_amenageur'), 60),
        tel: clean(first(row, 'telephone_operateur'), 30),
        lat: c.lat,
        lon: c.lon,
        p: 0,
        kw: 0,
        c: [],
        pay: [],
        free: bool(first(row, 'gratuit')),
        prix: clean(first(row, 'tarification'), 300),
        acc: first(row, 'condition_acces') === 'Accès réservé' ? 'reserve' : 'libre',
        h: clean(first(row, 'horaires'), 80),
        pmr: clean(first(row, 'accessibilite_pmr'), 40),
        maj: first(row, 'date_maj', 'horodatage_maj').slice(0, 10),
        pdc: [],
        ok: operatorKey(row)?.key ?? '',
      };
      stations.set(key, s);
    }
    if (s.ok) operators.observe(row, s.ok, key);
    s.p += 1;
    const kw = powerKw(row);
    if (kw > s.kw) s.kw = kw;
    const plugs = [
      ['ccs', 'prise_type_combo_ccs'], ['t2', 'prise_type_2'], ['chademo', 'prise_type_chademo'], ['ef', 'prise_type_ef'],
    ];
    // Prises de CE point (affichées par point dans l'app, filtrées selon le véhicule)
    const rowPlugs = plugs.filter(([, col]) => bool(row[col])).map(([code]) => code);
    for (const code of rowPlugs) if (!s.c.includes(code)) s.c.push(code);
    if (bool(row.cable_t2_attache)) s.cab = true;
    const pay = new Set(s.pay);
    if (bool(first(row, 'paiement_cb'))) pay.add('cb');
    if (bool(first(row, 'cb_sans_contact'))) pay.add('sans_contact');
    if (bool(first(row, 'paiement_acte'))) pay.add('acte');
    for (const m of adHocMethods(row)) pay.add(m);
    if (bool(first(row, 'paiement_autre')) || bool(first(row, 'abonnement'))) pay.add('badge');
    s.pay = [...pay];
    // Point : [id_pdc_itinerance, puissance kW, prises] ; au-delà de MAX_PDC, seul l'index EVSE le connaît.
    if (pdcId) {
      if (s.pdc.length < MAX_PDC) s.pdc.push([pdcId, kw, rowPlugs]);
      else (s.extra ??= []).push(pdcId);
    }
  }

  function stats() { return { rows, skipped, stations: stations.size, pdc: [...stations.values()].reduce((t, s) => t + s.p, 0) }; }

  return { add, stations, stats, operators: () => operators.build() };
}

/** Répartit les stations par tuile. */
export function toTiles(stations) {
  const tiles = new Map();
  for (const s of stations.values()) {
    const k = tileKey(s.lat, s.lon);
    if (!tiles.has(k)) tiles.set(k, []);
    const out = { ...s };
    for (const f of ['tel', 'prix', 'h', 'pmr', 'maj', 'a', 'o', 'ok']) if (!out[f]) delete out[f];
    delete out.extra;
    if (!out.free) delete out.free;
    if (!out.cab) delete out.cab;
    if (out.acc === 'libre') delete out.acc;
    if (!out.pdc.length) delete out.pdc;
    tiles.get(k).push(out);
  }
  return tiles;
}

/** Identifiant normalisé pour la recherche : majuscules, sans « * » ni espaces. */
export const normId = (id) => String(id).toUpperCase().replace(/[*\s]/g, '');

/** Seau d'index (FNV-1a 32 bits) — même calcul dans l'app (apps/mobile/src/lib/evse.ts). */
export function evseBucket(id) {
  let h = 0x811c9dc5;
  const s = normId(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % EVSE_BUCKETS).toString(16).padStart(2, '0');
}

/**
 * Index « identifiant de point ou de station → tuile » pour ouvrir une borne depuis un QR code ou un lien
 * profond sans connaître la position. Valeur : clé de tuile, ou « tuile|id_station » pour un point absent de la tuile.
 */
export function evseIndex(stations) {
  const buckets = new Map();
  const put = (id, value) => {
    const b = evseBucket(id);
    if (!buckets.has(b)) buckets.set(b, {});
    buckets.get(b)[normId(id)] = value;
  };
  for (const s of stations.values()) {
    const k = tileKey(s.lat, s.lon);
    put(s.id, k);
    for (const [id] of s.pdc) put(id, k);
    for (const id of s.extra ?? []) put(id, `${k}|${s.id}`);
  }
  return buckets;
}
