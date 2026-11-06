// « Le moins cher près de moi » : classement des bornes chargées par coût total estimé de MA recharge (estimate.ts),
// puis par distance. Prix inconnu → fin de liste (« Prix non publié »). Fonctions pures (cheapest.test.ts).
import { totalCost, type TotalCost } from './estimate';
import { distanceKm, type Plug, type Station } from './stations';
import { stationTariff } from './tariff';
import { compatible, GENERIC_VEHICLE, type VehicleModel } from './vehicle';

type V = Pick<VehicleModel, 'batteryKWh' | 'maxDcKW' | 'maxAcKW' | 'plugs' | 'consumptionKWhPer100'>;
type Pos = { lat: number; lon: number };

/** Point retenu pour l'estimation : le plus puissant compatible avec le véhicule (prises du point si publiées). */
export function bestPoint(s: Station, v: Pick<VehicleModel, 'plugs'> | null): { kw: number; plugs: Plug[] } {
  const ok = (plugs: Plug[]) => !v || compatible(plugs, v);
  const pts = (s.pdc ?? []).filter(([, , plugs]) => plugs?.length && ok(plugs)).map(([, kw, plugs]) => ({ kw: kw || s.kw, plugs: plugs! }));
  if (pts.length) return pts.reduce((a, b) => (b.kw > a.kw ? b : a));
  const plugs = v ? s.c.filter((p) => v.plugs.includes(p)) : s.c;
  return { kw: s.kw, plugs: plugs.length ? plugs : s.c };
}

export interface Detour {
  /** Distance aller (km) : itinéraire connu, sinon à vol d'oiseau. */
  km: number;
  routed: boolean;
  /** Durée aller (min) si l'itinéraire est connu, sinon null (estimation en ville affichée par l'écran). */
  min: number | null;
  /** Énergie consommée par le trajet aller (kWh) et son coût au prix effectif de la borne (null si prix inconnu). */
  kWh: number;
  cost: number | null;
}

export interface Ranked {
  s: Station;
  /** Distance depuis la position réelle (km), null sans position. */
  d: number | null;
  cost: TotalCost;
  detour: Detour | null;
  /** Montant de classement (€) : total, + détour si demandé ; null = prix inconnu. */
  score: number | null;
}

export interface RankOptions {
  vehicle: V | null;
  socPercent: number | null;
  /** Point de référence du classement (position, ou centre de la carte). */
  from: Pos;
  /** Position réelle (distance affichée) ; null : pas de distance affichée. */
  user: Pos | null;
  includeDetour: boolean;
  /** Itinéraires connus par borne (distance m, durée s). */
  routes?: Record<string, { distanceM: number; durationS: number }>;
  stayMin?: number | null;
  /** Rayon maximal (km) autour de `from` ; 20 km par défaut. */
  maxKm?: number;
  /** Nombre de bornes candidates (les plus proches) avant classement ; 60 par défaut. */
  pool?: number;
}

/** Bornes compatibles et accessibles, classées : coût connu croissant (puis distance), puis prix non publié par distance. */
export function rankCheapest(list: Station[], o: RankOptions): Ranked[] {
  const v = o.vehicle;
  const cons = (v ?? GENERIC_VEHICLE).consumptionKWhPer100;
  const near = list
    .filter((s) => s.acc !== 'reserve' && compatible(s.c, v))
    .map((s) => ({ s, k: distanceKm(o.from, s) }))
    .filter((x) => x.k <= (o.maxKm ?? 20))
    // Même emplacement publié deux fois (même opérateur, mêmes coordonnées, même tarif) : une seule ligne
    .filter((x, i, all) => all.findIndex((y) => y.s.o === x.s.o && y.s.lat === x.s.lat && y.s.lon === x.s.lon && y.s.prix === x.s.prix) === i)
    .sort((a, b) => a.k - b.k)
    .slice(0, o.pool ?? 60);
  const out = near.map(({ s, k }): Ranked => {
    const pt = bestPoint(s, v);
    const cost = totalCost({ vehicle: v, socPercent: o.socPercent, pointKw: pt.kw, plugs: pt.plugs, tariff: stationTariff(s), stayMin: o.stayMin });
    const d = o.user ? distanceKm(o.user, s) : null;
    let detour: Detour | null = null;
    if (o.includeDetour) {
      const r = o.routes?.[s.id];
      const dk = r ? r.distanceM / 1000 : d ?? k;
      const kWh = (dk * cons) / 100;
      detour = { km: dk, routed: !!r, min: r ? Math.round(r.durationS / 60) : null, kWh: Math.round(kWh * 10) / 10, cost: cost.effectivePerKwh != null ? round2(kWh * cost.effectivePerKwh) : null };
    }
    const score = cost.total == null ? null : round2(cost.total + (detour?.cost ?? 0));
    return { s, d, cost, detour, score };
  });
  const dist = (r: Ranked) => r.d ?? distanceKm(o.from, r.s);
  return out.sort((a, b) => {
    if (a.score == null || b.score == null) return a.score == null && b.score == null ? dist(a) - dist(b) : a.score == null ? 1 : -1;
    return a.score - b.score || dist(a) - dist(b);
  });
}

/** Seuil de la carte « Meilleur prix proche » : gain ≥ 15 % par rapport à la borne la plus proche. */
export const BEST_MIN_GAIN = 0.15;

/**
 * « 6 € de moins à 1,2 km » : la moins chère vs la plus proche au prix publié (une borne sans prix ne permet aucun
 * calcul de gain). Rien si c'est la même borne ou si le gain est < 15 %.
 */
export function bestNearby(ranked: Ranked[], from: Pos): { best: Ranked; nearest: Ranked; saving: number; gain: number } | null {
  const priced = ranked.filter((r) => r.score != null);
  if (!priced.length) return null;
  const dist = (r: Ranked) => r.d ?? distanceKm(from, r.s);
  const nearest = priced.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  const best = ranked[0];
  if (best.score == null || nearest.score == null || best.s.id === nearest.s.id || nearest.score <= 0) return null;
  const saving = round2(nearest.score - best.score);
  const gain = saving / nearest.score;
  return gain >= BEST_MIN_GAIN ? { best, nearest, saving, gain } : null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
