import { XMLParser } from 'fast-xml-parser';
import { round } from '../lib/geo.js';

export type IncidentType = 'accident' | 'travaux' | 'fermeture' | 'bouchon' | 'obstacle' | 'meteo' | 'autre';

export interface Incident {
  id: string;
  type: IncidentType;
  title: string;
  description: string;
  lon: number;
  lat: number;
  start: string | null;
  end: string | null;
  severity: 1 | 2 | 3;
  source: 'bison-fute' | 'communaute';
}

export interface DatexParseResult {
  publicationTime: string | null;
  incidents: Incident[];
}

type Node = Record<string, unknown>;
const isObj = (x: unknown): x is Node => typeof x === 'object' && x !== null && !Array.isArray(x);
const arr = (x: unknown): unknown[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);

/** Texte d'un nœud feuille (chaîne ou objet `{ '#text', '@_lang' }`). */
function text(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return String(x);
  if (isObj(x) && typeof x['#text'] === 'string') return x['#text'];
  return null;
}

/** Valeur multilingue DATEX (`values/value[@lang]`), français de préférence. */
function multilingual(x: unknown): string | null {
  if (!isObj(x)) return text(x);
  const values = arr(isObj(x.values) ? x.values.value : x.value);
  const fr = values.find((v) => isObj(v) && v['@_lang'] === 'fr') ?? values[0];
  return fr === undefined ? null : text(fr);
}

const localType = (n: Node): string => {
  const t = n['@_type'];
  return typeof t === 'string' ? (t.split(':').pop() ?? t) : '';
};

/** Premier nœud (profondeur d'abord) dont la clé vaut `key`. */
function findFirst(n: unknown, key: string, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (Array.isArray(n)) {
    for (const c of n) {
      const r = findFirst(c, key, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (!isObj(n)) return undefined;
  if (key in n) return n[key];
  for (const v of Object.values(n)) {
    const r = findFirst(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function findAll(n: unknown, key: string, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 14) return out;
  if (Array.isArray(n)) {
    for (const c of n) findAll(c, key, out, depth + 1);
  } else if (isObj(n)) {
    for (const [k, v] of Object.entries(n)) {
      if (k === key) out.push(...arr(v));
      else findAll(v, key, out, depth + 1);
    }
  }
  return out;
}

function latLonOf(x: unknown): { lat: number; lon: number } | null {
  if (!isObj(x)) return null;
  const lat = Number(text(x.latitude));
  const lon = Number(text(x.longitude));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/**
 * Coordonnées d'un enregistrement, par ordre de préférence :
 * v3 `locationForDisplay` → v2/v3 `pointByCoordinates` → TPEG `pointCoordinates` (premier point d'un linéaire : `from`)
 * → v3 `posList` d'un linéaire GML.
 */
function coordinates(rec: Node): { lat: number; lon: number } | null {
  const display = latLonOf(findFirst(rec, 'locationForDisplay'));
  if (display) return display;
  const pbc = findFirst(rec, 'pointByCoordinates');
  const fromPbc = latLonOf(isObj(pbc) ? pbc.pointCoordinates : undefined);
  if (fromPbc) return fromPbc;
  const loc = rec.groupOfLocations ?? rec.locationReference ?? rec;
  const linear = findFirst(loc, 'tpegLinearLocation');
  if (isObj(linear)) {
    const fromPt = latLonOf(findFirst(linear.from, 'pointCoordinates'));
    if (fromPt) return fromPt;
  }
  for (const pc of findAll(loc, 'pointCoordinates')) {
    const p = latLonOf(pc);
    if (p) return p;
  }
  const posList = text(findFirst(loc, 'posList'));
  if (posList) {
    const [a, b] = posList.trim().split(/\s+/).map(Number);
    if (a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)) {
      return latLonOf({ latitude: String(a), longitude: String(b) });
    }
  }
  return null;
}

/** Sous-type d'un enregistrement (valeur de `…Type`) pour affiner le mapping. */
function subtypes(rec: Node): string[] {
  const keys = [
    'accidentType',
    'roadOrCarriagewayOrLaneManagementType',
    'roadMaintenanceType',
    'constructionWorkType',
    'abnormalTrafficType',
    'obstructionType',
    'vehicleObstructionType',
    'animalPresenceType',
    'environmentalObstructionType',
    'equipmentOrSystemFaultType',
    'infrastructureDamageType',
    'weatherRelatedRoadConditionType',
    'poorEnvironmentType',
    'nonWeatherRelatedRoadConditionType',
    'reroutingManagementType',
    'trafficConstrictionType',
    'generalMessageToRoadUsersType',
  ];
  const out: string[] = [];
  for (const k of keys) for (const v of arr(rec[k])) {
    const t = text(v);
    if (t) out.push(t);
  }
  const impact = isObj(rec.impact) ? text(rec.impact.trafficConstrictionType) : null;
  if (impact) out.push(impact);
  return out;
}

const CLOSURE = new Set(['roadClosed', 'carriagewayClosures', 'closedPermanentlyForTheWinter', 'roadBlocked', 'rampClosures', 'intermittentShortTermClosures', 'tunnelClosed', 'bridgeClosed']);

export function mapType(xsiType: string, sub: string[]): IncidentType {
  switch (xsiType) {
    case 'Accident':
      return 'accident';
    case 'MaintenanceWorks':
    case 'ConstructionWorks':
    case 'Roadworks':
      return 'travaux';
    case 'AbnormalTraffic':
      return 'bouchon';
    case 'VehicleObstruction':
    case 'GeneralObstruction':
    case 'AnimalPresenceObstruction':
    case 'EnvironmentalObstruction':
    case 'InfrastructureDamageObstruction':
    case 'NonWeatherRelatedRoadConditions':
      return 'obstacle';
    case 'WeatherRelatedRoadConditions':
    case 'PoorEnvironmentConditions':
      return 'meteo';
    case 'RoadOrCarriagewayOrLaneManagement':
    case 'RoadManagement':
    case 'SpeedManagement':
    case 'ReroutingManagement':
      return sub.some((s) => CLOSURE.has(s)) ? 'fermeture' : 'autre';
    default:
      return sub.some((s) => CLOSURE.has(s)) ? 'fermeture' : 'autre';
  }
}

const TITLES: Record<string, string> = {
  roadClosed: 'Route fermée',
  closedPermanentlyForTheWinter: 'Fermeture hivernale',
  carriagewayClosures: 'Chaussée fermée',
  rampClosures: 'Bretelle fermée',
  laneClosures: 'Voie fermée',
  narrowLanes: 'Voies rétrécies',
  contraflow: 'Basculement de circulation',
  singleAlternateLineTraffic: 'Circulation alternée',
  weightRestrictionInOperation: 'Restriction de tonnage',
  heightRestrictionInOperation: 'Restriction de hauteur',
  snowOnTheRoad: 'Neige sur la chaussée',
  ice: 'Verglas',
  blackIce: 'Verglas',
  fog: 'Brouillard',
  flooding: 'Inondation',
  stationaryTraffic: 'Circulation à l’arrêt',
  queuingTraffic: 'Bouchon',
  slowTraffic: 'Circulation ralentie',
  resurfacingWork: 'Travaux de revêtement',
  doNotUseEntry: 'Entrée fermée',
  doNotUseExit: 'Sortie fermée',
  followLocalDiversion: 'Déviation',
  followDiversionSigns: 'Déviation',
};

const DEFAULT_TITLES: Record<IncidentType, string> = {
  accident: 'Accident',
  travaux: 'Travaux',
  fermeture: 'Fermeture',
  bouchon: 'Bouchon',
  obstacle: 'Obstacle sur la chaussée',
  meteo: 'Conditions météo difficiles',
  autre: 'Information trafic',
};

const SEVERITY: Record<string, 1 | 2 | 3> = { lowest: 1, low: 1, medium: 2, high: 3, highest: 3 };

function severityOf(rec: Node, situation: Node, type: IncidentType): 1 | 2 | 3 {
  const s = text(rec.severity) ?? text(situation.overallSeverity);
  if (s && SEVERITY[s]) return SEVERITY[s];
  return type === 'fermeture' || type === 'accident' ? 3 : type === 'autre' ? 1 : 2;
}

function iso(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const clean = (s: string, max: number) => {
  const t = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function description(rec: Node): string {
  const parts: string[] = [];
  for (const c of arr(rec.generalPublicComment)) {
    if (!isObj(c)) continue;
    const kind = text(c.commentType);
    if (kind && kind !== 'description' && kind !== 'locationDescriptor') continue;
    const v = multilingual(c.comment);
    // Les chemins administratifs (« DIR X/District Y/CEI Z ») n'apportent rien à l'usager.
    if (v && !(kind === 'locationDescriptor' && /^DIR [^/]+\//.test(v))) parts.push(v);
  }
  return clean([...new Set(parts)].join('\n'), 600);
}

/** Nom de route (N125, A75…) si présent, pour un titre plus parlant. */
function roadName(rec: Node): string | null {
  const n = text(findFirst(rec, 'roadNumber')) ?? multilingual(findFirst(rec, 'roadName'));
  const m = n ? /^([ANDM])\s?0*(\d{1,4}[a-z]?)$/i.exec(n.trim()) : null;
  return m ? `${(m[1] ?? '').toUpperCase()}${m[2] ?? ''}` : null;
}

export function createDatexParser() {
  return new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: { enabled: true, maxEntityCount: 20, maxTotalExpansions: 200, maxExpandedLength: 50_000 },
    isArray: (name) => name === 'situation' || name === 'situationRecord' || name === 'generalPublicComment',
  });
}

/**
 * DATEX II (v2 « d2LogicalModel », éventuellement enveloppé SOAP, ou v3 « messageContainer »)
 * → incidents normalisés. Tolérant : un enregistrement illisible ou sans coordonnées est ignoré.
 */
export function parseDatex(xml: string, parser = createDatexParser()): DatexParseResult {
  const doc: unknown = parser.parse(xml);
  const publication = findFirst(doc, 'payloadPublication') ?? findFirst(doc, 'payload') ?? doc;
  const publicationTime = iso(text(isObj(publication) ? publication.publicationTime : undefined));
  const incidents: Incident[] = [];
  const seen = new Set<string>();
  for (const sit of findAll(publication, 'situation')) {
    if (!isObj(sit)) continue;
    for (const rec of arr(sit.situationRecord)) {
      if (!isObj(rec)) continue;
      const pos = coordinates(rec);
      if (!pos) continue;
      const xsi = localType(rec);
      const sub = subtypes(rec);
      const type = mapType(xsi, sub);
      const rawId = typeof rec['@_id'] === 'string' ? rec['@_id'] : `${String(sit['@_id'] ?? 'x')}-${incidents.length}`;
      const id = `bf-${rawId.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const validity = isObj(rec.validity) && isObj(rec.validity.validityTimeSpecification) ? rec.validity.validityTimeSpecification : {};
      const label = sub.map((s) => TITLES[s]).find((t) => t !== undefined) ?? DEFAULT_TITLES[type];
      const road = roadName(rec);
      incidents.push({
        id,
        type,
        title: clean(road ? `${label} · ${road}` : label, 80),
        description: description(rec),
        lon: round(pos.lon, 6),
        lat: round(pos.lat, 6),
        start: iso(text(validity.overallStartTime)),
        end: iso(text(validity.overallEndTime)),
        severity: severityOf(rec, sit, type),
        source: 'bison-fute',
      });
    }
  }
  return { publicationTime, incidents };
}
