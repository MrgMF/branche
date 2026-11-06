import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Platform } from 'react-native';
import type { MapHandle } from '../components/MapView';
import type { MapOut } from '../components/mapHtml';
import {
  arrivalSoc,
  chargersOnRoute,
  checkFresh,
  deltaText,
  followOffsetFor,
  instructionOf,
  LOW_SOC,
  liveArrivalSoc,
  lostTraffic,
  maneuverOf,
  maneuverVoice,
  nextStepIndex,
  OFFER_ROUTE_ID,
  DONE_ROUTE_ID,
  offerAlt,
  offerDefault,
  offerStillValid,
  routeTolerance,
  pickAnnouncement,
  remainingLine,
  remapAnnounced,
  socAfterStop,
  socNowEstimate,
  speedKmh as computeSpeed,
  speedLimitAt,
  spokenDist,
  stepsAlong,
  tileProbes,
  trafficSegments,
  trafficSegmentsFrom,
  type ChargerSuggestion,
} from './guidance';
import { backgroundConsent, declineBackground, requestBackground, watchGeo, watchGeoBackground } from './geoWatch';
import { keepScreenOn } from './keepAwake';
import {
  alongRoute,
  angleDiff,
  bboxOf,
  bearing,
  circle,
  clientRouting,
  cumulative,
  distText,
  getIncidents,
  getRoute,
  incidentLabel,
  loadDangerZones,
  metersBetween,
  progressNear,
  progressOnRoute,
  routeOptions,
  segmentBearing,
  type DangerZone,
  type Incident,
  type LonLat,
  type Place,
  type RouteOption,
  type RouteOptions,
  type RouteStep,
} from './navigation';
import { loadAround, navName, type Station } from './stations';
import { loadVehicle, socAfter, type Vehicle } from './vehicle';
import { announce, loadVoicePref, speak, stopSpeaking, type Part } from './voice';
import { getSettings } from './settings';
import { tr } from '../i18n';

type Pos = { lat: number; lon: number };
export type RouteIncident = Incident & { alongM: number };
export type RouteZone = DangerZone & { alongM: number };

export interface Destination {
  id: string;
  name: string;
  sub?: string;
  lat: number;
  lon: number;
  station?: Station;
}
/** Borne choisie explicitement : son nom propre (jamais le nom IRVE brut en capitales). */
export const stationDest = (s: Station): Destination => ({ id: s.id, name: navName(s), sub: s.a, lat: s.lat, lon: s.lon, station: s });
/**
 * Lieu recherché : le nom recherché reste la destination. Une borne à moins de 40 m n'est rattachée que pour
 * l'enchaînement arrivée → recharge (fiche d'arrivée), jamais pour renommer la destination.
 */
export const searchDest = (p: Place, near: Station | null | undefined): Destination => ({ ...placeDest(p), ...(near ? { station: near } : {}) });
export const placeDest = (p: Place): Destination => ({ id: `p:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`, name: p.label, sub: p.sublabel, lat: p.lat, lon: p.lon });

export type GpsState = 'ok' | 'waiting' | 'lost' | 'unavailable';

/** Trajet plus rapide proposé pendant le guidage (décompte de 10 s, choix par défaut). */
export interface FasterOffer {
  route: RouteOption;
  gainS: number;
  deadline: number;
  def: 'take' | 'keep';
}

export interface Trip {
  dest: Destination;
  via: Destination[];
  options: RouteOptions;
  provider: 'tomtom' | 'valhalla' | null;
  traffic: boolean;
  /** Itinéraire calculé par l'app (site statique, Valhalla public, sans trafic). */
  client: boolean;
  routes: RouteOption[];
  selected: number;
  route: RouteOption | null;
  loading: boolean;
  error: string | null;
  incidents: RouteIncident[];
  zones: RouteZone[];
  feedOk?: boolean;
  feedUpdatedAt?: string | null;
  guiding: boolean;
  along: number;
  total: number;
  next: { step: RouteStep; index: number; inM: number } | null;
  then: { step: RouteStep; gapM: number } | null;
  speedKmh: number | null;
  limitKmh: number | null;
  remainingS: number;
  remainingM: number;
  alert: { text: string; tone: 'danger' | 'incident' } | null;
  toast: { text: string; tone: 'info' | 'success' | 'warn'; at: number } | null;
  gps: GpsState;
  arrived: boolean;
  arrivedAtVia: Destination | null;
  /** Batterie estimée à l'arrivée par trajet (id → %), si un véhicule est enregistré. En guidage : estimation continue. */
  battery: Record<string, number> | null;
  vehicleName: string | null;
  /** Batterie estimée en arrivant à l'étape de recharge. */
  viaSoc?: number | null;
  chargers: ChargerSuggestion[];
  rerouting: boolean;
  /** Le conducteur a choisi une alternative (pas le plus rapide) avant de démarrer. */
  driverChose: boolean;
  offer: FasterOffer | null;
  /** Guidage : batterie faible prévue à l'arrivée (sous LOW_SOC). */
  lowSoc: number | null;
  /** Natif : écran d'explication avant la permission « toujours » (guidage écran verrouillé). */
  bgAsk: boolean;
  /** Suivi en arrière-plan actif (natif). */
  background: boolean;
  /** Recherche de bornes en cours (alerte batterie en guidage). */
  chargerSearching: boolean;
  /** Hors itinéraire : recalcul demandé (ou en échec) — aucune flèche ni manœuvre de l'ancien tracé. */
  offRoute: boolean;
  /** Guidage : batterie actuelle estimée (%), si un véhicule est enregistré. */
  socNow: number | null;
}

const NO_OPTIONS: RouteOptions = { avoidTolls: false, avoidMotorways: false };
const ALERT_AHEAD_M = 2000;
const FASTER_CHECK_MS = 120_000;
const GPS_LOST_MS = 12_000;
const OFFER_MS = 10_000;
const WRONG_WAY_DEG = 120;
const DANGER_INCIDENTS = new Set(['accident', 'fermeture', 'obstacle']);

const blank = (dest: Destination, over: Partial<Trip> = {}): Trip => ({
  dest,
  via: [],
  options: NO_OPTIONS,
  provider: null,
  traffic: false,
  client: false,
  routes: [],
  selected: 0,
  route: null,
  loading: false,
  error: null,
  incidents: [],
  zones: [],
  guiding: false,
  along: 0,
  total: 0,
  next: null,
  then: null,
  speedKmh: null,
  limitKmh: null,
  remainingS: 0,
  remainingM: 0,
  alert: null,
  toast: null,
  gps: 'waiting',
  arrived: false,
  arrivedAtVia: null,
  battery: null,
  vehicleName: null,
  chargers: [],
  rerouting: false,
  driverChose: false,
  offer: null,
  lowSoc: null,
  bgAsk: false,
  background: false,
  chargerSearching: false,
  offRoute: false,
  socNow: null,
  ...over,
});

type Fix = { lat: number; lon: number; t: number; speed: number | null; heading: number | null; accuracy: number | null };

/** Décalage du véhicule (px) : plus bas, et centré dans la zone libre de la carte sur grand écran (guidance.ts). */
const followOffset = () => {
  const { width, height } = Dimensions.get('window');
  return followOffsetFor(width, height);
};

/** Marges du cadrage d'aperçu : sous la recherche et au-dessus de la feuille (mobile), à droite du panneau (large). */
const previewPad = (sheetH: number) =>
  Dimensions.get('window').width >= 768 ? { top: 90, bottom: 60, left: 16 + 440 + 40, right: 100 } : { top: 150, bottom: sheetH + 30 };

export function useTrip(map: React.RefObject<MapHandle | null>, user: Pos | null, sheetH: number) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const tripRef = useRef<Trip | null>(null);
  tripRef.current = trip;
  const along = useRef<number[]>([]);
  const cum = useRef<number[]>([]);
  const prevAlong = useRef<number | null>(null);
  const announced = useRef(new Set<string>());
  const lastReroute = useRef(0);
  const inFlight = useRef(false);
  const offCount = useRef(0);
  const wrongWay = useRef(0);
  const watch = useRef<{ remove: () => void } | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const prevFix = useRef<Fix | null>(null);
  const lastBearing = useRef<number | undefined>(undefined);
  const lastFixAt = useRef(0);
  const feed = useRef<{ incidents: Incident[]; zones: DangerZone[] }>({ incidents: [], zones: [] });
  const vehicle = useRef<Vehicle | null>(null);
  const reqId = useRef(0);
  const driven = useRef(0);
  const prevArrival = useRef<number | null>(null);
  const declined = useRef<{ geometry: LonLat[]; gainS: number } | null>(null);
  const lastDrawAlong = useRef(-1e9);
  const lastProg = useRef<{ seg: number; along: number } | null>(null);
  const backOn = useRef(0);
  const chargerLoad = useRef(false);

  useEffect(() => {
    void loadVoicePref();
  }, []);

  /** Nouveau tracé suivi : repères de progression remis à zéro (le tracé part de la position). */
  const resetProgress = useCallback((route: RouteOption | null, fromStart: boolean) => {
    along.current = route ? stepsAlong(route) : [];
    cum.current = route ? cumulative(route.geometry) : [];
    prevAlong.current = fromStart ? 0 : null;
    offCount.current = 0;
    wrongWay.current = 0;
    lastDrawAlong.current = -1e9;
    lastProg.current = null;
    backOn.current = 0;
    chargerLoad.current = false;
  }, []);

  // ---------------------------------------------------------------- carte
  /** Guidage : tronçon parcouru estompé (gris, sous le tracé), reste du trajet et trafic à venir, trajet proposé (« −X min »). */
  const drawProgress = useCallback(
    (route: RouteOption, seg: number, alongM: number, force = false) => {
      lastProg.current = { seg, along: alongM };
      if (!force && Math.abs(alongM - lastDrawAlong.current) < 25) return;
      lastDrawAlong.current = alongM;
      const line = route.geometry;
      const c = cum.current;
      const a = line[seg], b = line[seg + 1];
      if (!a || !b) return;
      const len = (c[seg + 1] ?? 0) - (c[seg] ?? 0);
      const k = len > 0 ? Math.max(0, Math.min(1, (alongM - (c[seg] ?? 0)) / len)) : 0;
      const here: LonLat = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      const done = [...line.slice(0, seg + 1), here];
      map.current?.post({
        type: 'routes',
        main: [here, ...line.slice(seg + 1)],
        segments: trafficSegmentsFrom(route, seg),
        alts: [...(done.length >= 2 ? [{ id: DONE_ROUTE_ID, coords: done, label: '' }] : []), ...offerAlt(tripRef.current?.offer, prevFix.current)],
      });
    },
    [map],
  );

  const draw = useCallback(
    (t: Trip) => {
      const r = t.route;
      if (!r) return;
      const best = t.routes[0];
      // Guidage déjà en cours sur ce tracé : tronçon parcouru conservé (et proposition de trajet plus rapide).
      if (t.guiding && lastProg.current) drawProgress(r, lastProg.current.seg, lastProg.current.along, true);
      else map.current?.post({
        type: 'routes',
        main: r.geometry,
        segments: trafficSegments(r),
        alts: t.guiding
          ? offerAlt(t.offer, prevFix.current)
          : t.routes
              .map((x, i) => ({ x, i }))
              .filter(({ i }) => i !== t.selected)
              .map(({ x }) => ({ id: x.id, coords: x.geometry, label: best ? (x.id === best.id ? tr().guidance.fastestLabel : deltaText(x.durationS - best.durationS)) : '' })),
      });
      map.current?.post({ type: 'dest', lat: t.dest.lat, lon: t.dest.lon, label: t.dest.name });
      const pins = t.guiding ? t.via : t.chargers.map((c) => ({ id: c.station.id, name: `${Math.round(c.station.kw)} kW`, lat: c.station.lat, lon: c.station.lon }));
      map.current?.post({ type: 'pins', items: [...pins, ...(t.guiding ? [] : t.via)].map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: p.name })) });
      map.current?.post({
        type: 'incidents',
        items: t.incidents.map((i) => ({ id: i.id, lon: i.lon, lat: i.lat, type: i.type, title: incidentLabel(i.type) ?? i.title })),
      });
      map.current?.post({ type: 'zones', polys: t.zones.map((z) => circle(z)) });
    },
    [map, drawProgress],
  );

  /** Perturbations, zones, batterie et bornes pour le trajet sélectionné. */
  const annotate = useCallback(async (t: Trip): Promise<Trip> => {
    const r = t.route;
    if (!r) return t;
    const line = r.geometry;
    const incidents = alongRoute(feed.current.incidents, line, 250);
    const zones = alongRoute(feed.current.zones, line, (z) => z.radiusM);
    const v = vehicle.current;
    let battery: Trip['battery'] = null;
    let chargers: ChargerSuggestion[] = t.chargers;
    let viaSoc: number | null = null;
    if (v) {
      // En guidage, le trajet recalculé part de la position : batterie actuelle estimée.
      const vNow = t.guiding ? { ...v, socPercent: socNowEstimate(v, socAfter, driven.current, 90) } : v;
      battery = Object.fromEntries(t.routes.map((x) => [x.id, arrivalSoc(vNow, socAfter, x.distanceM, x.durationS)]));
      if (t.guiding) {
        const live = Math.min(battery[r.id] ?? 100, prevArrival.current ?? 100);
        battery[r.id] = live;
      }
      if ((battery[r.id] ?? 100) < LOW_SOC && !t.via.length) {
        const lists = await Promise.all(tileProbes(line).map((p) => loadAround(p, 0).catch(() => [] as Station[])));
        chargers = chargersOnRoute(lists.flat(), line, vNow, socAfter, r.distanceM).filter((c) => !t.via.some((x) => x.id === c.station.id));
      } else if (!t.guiding) chargers = [];
      const via = t.via[0];
      if (via) {
        const a = progressOnRoute(via, line).along;
        viaSoc = arrivalSoc(vNow, socAfter, a, r.durationS * (a / Math.max(1, r.distanceM)));
      }
    }
    return { ...t, incidents, zones, battery, viaSoc, vehicleName: v?.name ?? null, chargers, total: progressOnRoute(t.dest, line).total };
  }, []);

  const commit = useCallback(
    (t: Trip) => {
      tripRef.current = t;
      setTrip(t);
      draw(t);
    },
    [draw],
  );

  // ---------------------------------------------------------------- calcul
  const compute = useCallback(
    async (base: Trip, from: Pos, mode: 'preview' | 'reroute') => {
      const id = ++reqId.current;
      setTrip({ ...base, loading: true, error: null, rerouting: mode === 'reroute' });
      try {
        // En guidage, le véhicule garde la batterie de départ du trajet en cours (déclarée ou estimée après une étape).
        if (mode === 'preview' || !vehicle.current) vehicle.current = await loadVehicle().catch(() => null);
        // Serveur public (site statique) : anti-rebond, seule la dernière demande d'aperçu part.
        if (clientRouting() && mode === 'preview') {
          await new Promise((r) => setTimeout(r, 700));
          if (id !== reqId.current) return;
        }
        const res = await getRoute(from, base.dest, { via: base.via, options: base.options });
        if (id !== reqId.current) return;
        let routes = routeOptions(res);
        if (mode === 'reroute') routes = routes.slice(0, 1);
        const all = routes.flatMap((r) => r.geometry);
        if (mode === 'preview') map.current?.post({ type: 'fit', bounds: bboxOf(all, 0.002), ...previewPad(sheetH) });
        const [f, zones] = await Promise.all([
          getIncidents(bboxOf(all)).catch(() => ({ incidents: [] as Incident[], feedOk: false, updatedAt: null })),
          loadDangerZones(),
        ]);
        if (id !== reqId.current) return;
        feed.current = { incidents: f.incidents, zones };
        const route = routes[0] ?? null;
        resetProgress(route, mode === 'reroute');
        // Nouveau tracé en guidage : la première manœuvre s'affiche tout de suite (sans attendre la position suivante).
        let first: Partial<Pick<Trip, 'next' | 'then'>> = {};
        if (mode === 'reroute') {
          announced.current = new Set([...announced.current].filter((k) => !/^s\d+:/.test(k)));
          prevArrival.current = null;
          const i = route ? nextStepIndex(along.current, route.steps, 0) : -1;
          if (route && i >= 0) {
            const after = route.steps[i + 1];
            first = { next: { step: route.steps[i]!, index: i, inM: along.current[i]! }, then: after ? { step: after, gapM: along.current[i + 1]! - along.current[i]! } : null };
          }
        }
        const next = await annotate({
          ...base,
          provider: res.provider,
          traffic: res.traffic,
          client: !!res.client,
          routes,
          selected: 0,
          route,
          loading: false,
          rerouting: false,
          feedOk: f.feedOk,
          feedUpdatedAt: f.updatedAt,
          offer: null,
          driverChose: mode === 'reroute' ? false : base.driverChose,
          chargers: mode === 'reroute' ? [] : base.chargers,
          offRoute: false,
          ...first,
          toast:
            mode === 'reroute'
              ? lostTraffic(base, res)
                ? { text: tr().navx.trafficLost, tone: 'warn', at: Date.now() }
                : { text: tr().guidance.newRoute, tone: 'info', at: Date.now() }
              : base.toast,
        });
        if (id !== reqId.current) return;
        commit(next);
        // Hors itinéraire : « Nouvel itinéraire » seulement une fois le recalcul réussi (à la détection : « Recalcul »).
        if (mode === 'reroute' && base.offRoute) speak(tr().voice.newRoute);
      } catch (e) {
        if (id !== reqId.current) return;
        const msg = e instanceof Error ? e.message : tr().trip.unavailable;
        // Aperçu sans itinéraire : destination marquée et cadrée avec la position (le conducteur voit où il va).
        if (mode === 'preview') {
          map.current?.post({ type: 'route', coords: [] });
          map.current?.post({ type: 'pins', items: [] });
          map.current?.post({ type: 'dest', lat: base.dest.lat, lon: base.dest.lon, label: base.dest.name });
          map.current?.post({ type: 'fit', bounds: bboxOf([[from.lon, from.lat], [base.dest.lon, base.dest.lat]], 0.004), ...previewPad(sheetH), maxZoom: 15 });
        }
        // En guidage, on garde l'ancien tracé : un recalcul raté n'interrompt pas la conduite.
        // Hors itinéraire, l'état « recalcul » reste affiché (sans flèche ni manœuvre périmée) jusqu'au prochain essai réussi.
        setTrip((t) =>
          t
            ? mode === 'reroute' && t.route
              ? { ...t, loading: false, rerouting: false, ...(t.offRoute ? { next: null, then: null } : {}), toast: { text: tr().guidance.rerouteFailed, tone: 'warn', at: Date.now() } }
              : { ...t, loading: false, rerouting: false, error: msg }
            : t,
        );
      } finally {
        inFlight.current = false;
      }
    },
    [annotate, commit, map, sheetH, resetProgress],
  );

  const plan = useCallback(
    (d: Station | Destination) => {
      const dest = 'station' in d || 'name' in d ? (d as Destination) : stationDest(d as Station);
      announced.current.clear();
      declined.current = null;
      const prev = tripRef.current;
      const set = getSettings();
      const base = blank(dest, { options: prev?.options ?? { avoidTolls: set.avoidTolls, avoidMotorways: set.avoidMotorways }, routes: prev?.dest.id === dest.id ? prev.routes : [] });
      if (!user) {
        setTrip({ ...base, error: tr().trip.noPosition, gps: 'unavailable' });
        // Sans position : destination marquée et centrée
        map.current?.post({ type: 'route', coords: [] });
        map.current?.post({ type: 'dest', lat: dest.lat, lon: dest.lon, label: dest.name });
        map.current?.post({ type: 'fly', lat: dest.lat, lon: dest.lon, zoom: 15, offsetY: Dimensions.get('window').width >= 768 ? 0 : -sheetH * 0.4 });
        return;
      }
      void compute(base, user, 'preview');
    },
    [user, compute, map, sheetH],
  );

  /** Échec du calcul : nouvel essai vers la même destination (mêmes options). */
  const retry = useCallback(() => {
    const t = tripRef.current;
    if (!t || t.guiding) return;
    if (!user) {
      setTrip({ ...t, error: tr().trip.noPosition, gps: 'unavailable' });
      return;
    }
    void compute({ ...t, error: null }, user, 'preview');
  }, [user, compute]);

  const setOption = useCallback(
    (k: keyof RouteOptions, v: boolean) => {
      const t = tripRef.current;
      if (!t || !user || t.guiding) return;
      void compute({ ...t, options: { ...t.options, [k]: v } }, user, 'preview');
    },
    [user, compute],
  );

  const selectRoute = useCallback(
    async (idOrIndex: string | number) => {
      const t = tripRef.current;
      if (!t || t.guiding) return;
      const i = typeof idOrIndex === 'number' ? idOrIndex : t.routes.findIndex((r) => r.id === idOrIndex);
      const route = t.routes[i];
      if (!route || i === t.selected) return;
      resetProgress(route, false);
      commit(await annotate({ ...t, selected: i, route, driverChose: i !== 0 }));
    },
    [annotate, commit, resetProgress],
  );

  const addVia = useCallback(
    (s: Station) => {
      const t = tripRef.current;
      const p = prevFix.current ?? user;
      if (!t || !p) return;
      if (t.guiding) {
        lastReroute.current = Date.now();
        inFlight.current = true;
        void compute({ ...t, via: [stationDest(s)], chargers: [], lowSoc: null }, p, 'reroute');
        return;
      }
      void compute({ ...t, via: [stationDest(s)], chargers: [] }, p, 'preview');
    },
    [user, compute],
  );

  const removeVia = useCallback(() => {
    const t = tripRef.current;
    if (!t || !user) return;
    void compute({ ...t, via: [] }, user, 'preview');
  }, [user, compute]);

  const stopWatch = useCallback(() => {
    watch.current?.remove();
    watch.current = null;
  }, []);

  const clear = useCallback(() => {
    reqId.current++;
    stopWatch();
    stopSpeaking();
    void keepScreenOn(false);
    setTrip(null);
    tripRef.current = null;
    setFix(null);
    prevFix.current = null;
    driven.current = 0;
    prevArrival.current = null;
    declined.current = null;
    chargerLoad.current = false;
    map.current?.post({ type: 'route', coords: [] });
    map.current?.post({ type: 'dest' });
    map.current?.post({ type: 'pins', items: [] });
    map.current?.post({ type: 'incidents', items: [] });
    map.current?.post({ type: 'zones', polys: [] });
    map.current?.post({ type: 'unfollow' });
  }, [map, stopWatch]);

  const startWatch = useCallback(async () => {
    stopWatch();
    try {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (perm && perm.status !== 'granted') {
        const asked = await Location.requestForegroundPermissionsAsync();
        if (asked.status !== 'granted') throw new Error('refusé');
      }
      // Natif avec accord « toujours » : suivi en arrière-plan (voix écran verrouillé), sinon premier plan.
      const n = tr().navx;
      const bg = Platform.OS === 'web' ? null : await watchGeoBackground(setFix, { title: n.bgNotifTitle, body: n.bgNotifBody }).catch(() => null);
      if (!tripRef.current?.guiding) {
        bg?.remove();
        return;
      }
      watch.current = bg ?? (await watchGeo(setFix, (code) => code === 'denied' && setTrip((t) => (t ? { ...t, gps: 'unavailable' } : t))));
      setTrip((t) => (t ? { ...t, background: !!bg } : t));
    } catch {
      setTrip((t) => (t ? { ...t, gps: 'unavailable' } : t));
    }
  }, [stopWatch]);

  const start = useCallback(async () => {
    const t = tripRef.current;
    if (!t?.route) return;
    lastFixAt.current = Date.now();
    driven.current = 0;
    prevArrival.current = null;
    chargerLoad.current = false;
    resetProgress(t.route, false);
    const web = Platform.OS === 'web';
    const g: Trip = { ...t, guiding: true, gps: 'waiting', driverChose: t.selected !== 0, toast: web ? { text: tr().navx.webBackground, tone: 'info', at: Date.now() } : null };
    commit(g);
    void keepScreenOn(true);
    const first = t.route.steps.find((s) => maneuverOf(s) !== 'depart') ?? t.route.steps[0];
    const delay = t.traffic && t.route.trafficDelayS > 60 ? Math.round(t.route.trafficDelayS / 60) : null;
    announce([{ text: tr().voice.go(t.dest.name, delay, first ? instructionOf(first) : null), priority: 'maneuver' }]);
    await startWatch();
    // Permission « toujours » demandée seulement ici, après un écran d'explication (jamais d'office).
    if (!web && (await backgroundConsent()) === 'ask' && tripRef.current?.guiding) setTrip((x) => (x ? { ...x, bgAsk: true } : x));
  }, [commit, startWatch, resetProgress]);

  const allowBackground = useCallback(async () => {
    setTrip((x) => (x ? { ...x, bgAsk: false } : x));
    const ok = await requestBackground();
    if (ok && tripRef.current?.guiding) await startWatch();
    else setTrip((x) => (x ? { ...x, toast: { text: tr().navx.bgDenied, tone: 'info', at: Date.now() } } : x));
  }, [startWatch]);

  const refuseBackground = useCallback(() => {
    void declineBackground();
    setTrip((x) => (x ? { ...x, bgAsk: false, toast: { text: tr().navx.bgDenied, tone: 'info', at: Date.now() } } : x));
  }, []);

  /**
   * Arrivé à une étape (borne) : reprendre vers la destination finale. `declaredSoc` : batterie déclarée après la recharge ;
   * sans déclaration, on repart de l'estimation courante (jamais du niveau saisi au départ). Le profil véhicule n'est pas
   * modifié (contrat : la navigation ne fait que lire) : le niveau vaut pour ce trajet.
   */
  const resumeAfterVia = useCallback((declaredSoc?: number) => {
    const t = tripRef.current;
    const p = fix ?? user;
    if (!t || !p) return;
    lastReroute.current = Date.now();
    const v = vehicle.current;
    if (v) {
      const avg = t.route && t.route.durationS > 0 ? t.route.distanceM / 1000 / (t.route.durationS / 3600) : 50;
      vehicle.current = { ...v, socPercent: socAfterStop(socNowEstimate(v, socAfter, driven.current, avg), declaredSoc), socUpdatedAt: Date.now() };
    }
    driven.current = 0;
    prevArrival.current = null;
    void compute({ ...t, via: t.via.slice(1), arrivedAtVia: null, guiding: true, lowSoc: null, socNow: vehicle.current?.socPercent ?? null }, p, 'reroute');
    if (!watch.current) void startWatch();
    void keepScreenOn(true);
  }, [compute, fix, user, startWatch]);

  /** Proposition devenue caduque (le conducteur a quitté le trajet proposé) : retirée en silence, tracé effacé. */
  const dropOffer = useCallback(() => {
    const t = tripRef.current;
    if (!t?.offer) return;
    tripRef.current = { ...t, offer: null };
    setTrip((x) => (x ? { ...x, offer: null } : x));
    if (t.route && lastProg.current) drawProgress(t.route, lastProg.current.seg, lastProg.current.along, true);
  }, [drawProgress]);

  /** Trajet proposé accepté (bouton « Prendre » ou fin du décompte). */
  const takeOffer = useCallback(async () => {
    const t = tripRef.current;
    const o = t?.offer;
    if (!t || !o || !t.route) return;
    // Bifurcation dépassée depuis la proposition : plus sur le trajet proposé, l'offre disparaît avec un court message.
    const here = prevFix.current;
    if (here && !offerStillValid(here, o)) {
      dropOffer();
      setTrip((x) => (x ? { ...x, toast: { text: tr().navx.offerMissed, tone: 'info', at: Date.now() } } : x));
      return;
    }
    const min = Math.round(o.gainS / 60);
    announced.current = remapAnnounced(t.route.steps, o.route.steps, announced.current);
    resetProgress(o.route, true);
    // Progression recalée sur la position actuelle (le trajet proposé partait de la position au moment du calcul).
    if (here) prevAlong.current = progressOnRoute(here, o.route.geometry).along;
    prevArrival.current = null;
    declined.current = null;
    speak(tr().voice.faster(min));
    commit(
      await annotate({
        ...t,
        routes: [o.route],
        selected: 0,
        route: o.route,
        offer: null,
        driverChose: false,
        remainingS: o.route.durationS,
        remainingM: o.route.distanceM,
        toast: { text: tr().guidance.faster(min), tone: 'success', at: Date.now() },
      }),
    );
  }, [annotate, commit, resetProgress, dropOffer]);

  /** Trajet proposé refusé : le conducteur garde son trajet (pas re-proposé sauf gain nettement meilleur). */
  const keepOffer = useCallback(() => {
    const t = tripRef.current;
    const o = t?.offer;
    if (!t || !o) return;
    declined.current = { geometry: o.route.geometry, gainS: o.gainS };
    const next: Trip = { ...t, offer: null, toast: { text: tr().navx.kept, tone: 'info', at: Date.now() } };
    tripRef.current = next;
    setTrip((x) => (x ? { ...x, offer: null, toast: next.toast } : x));
    // Le tracé proposé disparaît de la carte dès la décision.
    if (t.route && lastProg.current) drawProgress(t.route, lastProg.current.seg, lastProg.current.along, true);
  }, [drawProgress]);

  const onMapMessage = useCallback(
    (m: MapOut) => {
      if (m.type === 'tapRoute') {
        // Toucher le trajet proposé (guidage) = le prendre.
        if (m.id === OFFER_ROUTE_ID && tripRef.current?.offer) void takeOffer();
        else void selectRoute(m.id);
      }
      else if (m.type === 'tapPin') {
        const c = tripRef.current?.chargers.find((x) => x.station.id === m.id);
        if (c) addVia(c.station);
      }
    },
    [selectRoute, addVia, takeOffer],
  );

  /** Bornes rapides sur le reste du trajet, depuis la batterie actuelle estimée (alerte batterie en guidage). */
  const loadChargers = useCallback(async () => {
    const t = tripRef.current;
    const v = vehicle.current;
    if (!t?.route || !v || chargerLoad.current) return;
    chargerLoad.current = true;
    setTrip((x) => (x ? { ...x, chargerSearching: true } : x));
    const vNow = { ...v, socPercent: socNowEstimate(v, socAfter, driven.current, 90) };
    const line = t.route.geometry;
    const lists = await Promise.all(tileProbes(line).map((p) => loadAround(p, 0).catch(() => [] as Station[])));
    const from = t.along;
    const list = chargersOnRoute(lists.flat(), line, vNow, socAfter, t.route.distanceM, 6).filter((c) => c.alongM > from + 300);
    setTrip((x) => (x ? { ...x, chargerSearching: false, ...(x.route === t.route ? { chargers: list } : {}) } : x));
  }, []);

  // ---------------------------------------------------------------- guidage
  useEffect(() => {
    const p = fix;
    const t = tripRef.current;
    if (!p || !t?.guiding || !t.route || t.arrived || t.arrivedAtVia) return;
    lastFixAt.current = Date.now();
    // Position reçue : le bandeau « GPS perdu » disparaît même si ce passage se termine par un recalcul.
    if (t.gps !== 'ok') setTrip((x) => (x ? { ...x, gps: 'ok' } : x));
    const route = t.route;
    const line = route.geometry;
    if (cum.current.length !== line.length) resetProgress(route, false);
    const prev = prevFix.current;
    const speed = computeSpeed(p.speed, prev, p);
    // Recalage dans une fenêtre autour de la progression précédente (portée selon la vitesse).
    const ahead = Math.max(1500, ((speed ?? 50) / 3.6) * 45);
    const prog = progressNear(p, line, cum.current, prevAlong.current, 150, ahead);
    const moved = prev ? metersBetween(prev, p) : 0;
    if (prev && p.t - prev.t < 30_000 && moved < 500) driven.current += moved;
    let course: number | null = null;
    if (p.heading !== null && p.heading >= 0 && (speed ?? 0) > 5) course = p.heading;
    else if (prev && moved > 6) course = bearing(prev, p);
    if (course !== null) lastBearing.current = course;
    prevFix.current = p;
    const zoom = (speed ?? 0) > 80 ? 15 : (speed ?? 0) > 45 ? 16 : 17;
    map.current?.post({ type: 'user', lat: p.lat, lon: p.lon, bearing: lastBearing.current, nav: true });
    const off = followOffset();
    map.current?.post({ type: 'follow', lat: p.lat, lon: p.lon, bearing: lastBearing.current, zoom, offsetX: off.x, offsetY: off.y });

    // Hors trajet : 2 positions consécutives au-delà de la tolérance (précision GPS comprise).
    const tol = routeTolerance(p.accuracy);
    if ((p.accuracy ?? 0) <= 100) offCount.current = prog.off > tol ? offCount.current + 1 : 0;
    if (prog.off <= tol) prevAlong.current = prog.along;
    // Contresens : cap opposé (> 120°) au sens du trajet sur 2 positions, en roulant.
    const segB = segmentBearing(line, prog.seg);
    if (segB !== null && course !== null && (speed ?? 0) > 8 && prog.off <= tol) wrongWay.current = angleDiff(course, segB) > WRONG_WAY_DEG ? wrongWay.current + 1 : 0;
    if ((offCount.current >= 2 || wrongWay.current >= 2) && !inFlight.current && Date.now() - lastReroute.current > 10_000) {
      // Hors du trajet actuel mais déjà engagé sur le trajet proposé : on le prend sans recalcul ni « Recalcul »
      // (takeOffer annonce le gain et bascule le guidage sur le trajet proposé).
      if (t.offer && offerStillValid(p, t.offer)) {
        offCount.current = 0;
        wrongWay.current = 0;
        void takeOffer();
        return;
      }
      lastReroute.current = Date.now();
      offCount.current = 0;
      wrongWay.current = 0;
      inFlight.current = true;
      // « Nouvel itinéraire » seulement après le succès du recalcul (compute).
      speak(tr().voice.rerouting);
      backOn.current = 0;
      void compute({ ...t, gps: 'ok', offer: null, offRoute: true, next: null, then: null }, p, 'reroute');
      return;
    }
    // Recalcul en échec : on retrouve l'ancien tracé (2 positions sur le tracé, dans le bon sens) → guidage normal.
    let offRoute = t.offRoute;
    if (offRoute) {
      backOn.current = prog.off <= tol && wrongWay.current === 0 ? backOn.current + 1 : 0;
      if (backOn.current >= 2) {
        offRoute = false;
        backOn.current = 0;
      }
    }

    // Trajet plus rapide proposé : le conducteur doit rester dessus pendant le décompte, sinon l'offre est retirée en silence.
    let offerGone = false;
    if (t.offer && !offerStillValid(p, t.offer)) {
      offerGone = true;
      tripRef.current = { ...t, offer: null };
      setTrip((x) => (x ? { ...x, offer: null } : x));
    }

    // Étape (borne) atteinte : écran libéré pendant la recharge (repris par resumeAfterVia).
    const via = t.via[0];
    if (via && metersBetween(p, via) < 50) {
      void keepScreenOn(false);
      announce([{ text: tr().voice.viaReached(via.name), priority: 'maneuver' }]);
      setTrip((x) => (x ? { ...x, arrivedAtVia: via, speedKmh: speed, offer: null } : x));
      map.current?.post({ type: 'follow', lat: via.lat, lon: via.lon, bearing: 0, pitch: 0, zoom: 17, offsetX: followOffset().x, offsetY: -120, duration: 1200 });
      return;
    }

    // Une seule annonce par position : manœuvre, puis dangers, puis informations.
    const parts: Part[] = [];
    const idx = nextStepIndex(along.current, route.steps, prog.along);
    const step = idx >= 0 ? route.steps[idx] : null;
    const inM = step ? Math.max(0, along.current[idx] - prog.along) : 0;
    const next = step ? { step, index: idx, inM } : null;
    const after = idx >= 0 && idx + 1 < route.steps.length ? { step: route.steps[idx + 1], gapM: along.current[idx + 1] - along.current[idx] } : null;
    // Hors itinéraire : aucune manœuvre de l'ancien tracé n'est annoncée.
    if (step && !offRoute) {
      const legM = idx > 0 ? along.current[idx] - along.current[idx - 1] : along.current[idx];
      const level = pickAnnouncement(idx, inM, legM, speed, announced.current);
      // Étape et arrivée : « Dans X… » seulement ; l'arrivée elle-même a sa propre annonce (pas de doublon).
      const text = level ? maneuverVoice(level, inM, step, after ?? undefined) : null;
      if (text) parts.push({ text, priority: 'maneuver' });
    }

    let alert: Trip['alert'] = null;
    const zone = t.zones.find((z) => metersBetween(p, z) <= z.radiusM);
    if (zone) {
      alert = { text: tr().guidance.dangerZone, tone: 'danger' };
      if (!announced.current.has(`z${zone.id}`)) {
        announced.current.add(`z${zone.id}`);
        parts.push({ text: tr().voice.dangerZone, priority: 'danger' });
      }
    }
    const inc = t.incidents.find((i) => i.alongM > prog.along && i.alongM - prog.along < ALERT_AHEAD_M);
    if (inc) {
      const label = incidentLabel(inc.type) ?? tr().incident.autre;
      alert = alert ?? { text: tr().guidance.incidentIn(label, distText(inc.alongM - prog.along)), tone: 'incident' };
      if (!announced.current.has(`i${inc.id}`)) {
        announced.current.add(`i${inc.id}`);
        parts.push({ text: tr().navx.incidentVoice(inc.type, label, spokenDist(inc.alongM - prog.along)), priority: DANGER_INCIDENTS.has(inc.type) ? 'danger' : 'info' });
      }
    }
    const total = prog.total || route.distanceM;
    const remainingM = Math.max(0, total - prog.along);
    const remainingS = route.durationS * (total ? remainingM / total : 1);

    // Batterie : actuelle estimée − consommation du reste, jamais remontante ; alerte sous LOW_SOC.
    const v = vehicle.current;
    let battery = t.battery;
    let viaSoc = t.viaSoc ?? null;
    let lowSoc: number | null = null;
    let socNowPct: number | null = null;
    if (v) {
      const avg = route.durationS > 0 ? route.distanceM / 1000 / (route.durationS / 3600) : 50;
      const socNow = socNowEstimate(v, socAfter, driven.current, avg);
      socNowPct = Math.max(0, Math.round(socNow));
      const live = liveArrivalSoc(v, socAfter, socNow, remainingM, remainingS, prevArrival.current);
      prevArrival.current = live;
      battery = { ...(t.battery ?? {}), [route.id]: live };
      if (via) {
        const toVia = Math.max(0, progressOnRoute(via, line).along - prog.along);
        viaSoc = liveArrivalSoc(v, socAfter, socNow, toVia, remainingS * (toVia / Math.max(1, remainingM)), t.viaSoc ?? null);
      } else if (live < LOW_SOC) {
        lowSoc = live;
        const c = t.chargers.find((x) => x.alongM > prog.along + 300);
        if (!announced.current.has('lowsoc')) {
          announced.current.add('lowsoc');
          parts.push({ text: tr().navx.lowSocVoice(Math.max(0, live), c ? navName(c.station) : null), priority: 'danger' });
        }
        // Borne proposée dépassée ou aucune : nouvelle recherche sur le reste du trajet (une fois par tracé).
        if (!c && !chargerLoad.current) void loadChargers();
      }
    }

    const arrived = (!offRoute && remainingM < 30) || metersBetween(p, t.dest) < 40;
    if (arrived) {
      parts.length = 0;
      parts.push({ text: t.dest.station ? tr().voice.arrivedStation(t.dest.name) : tr().voice.arrived(t.dest.name), priority: 'maneuver' });
      stopWatch();
      void keepScreenOn(false);
      // Recentrage sur la destination, vue du dessus, au-dessus de la fiche d'arrivée.
      map.current?.post({ type: 'follow', lat: t.dest.lat, lon: t.dest.lon, bearing: 0, pitch: 0, zoom: 17, offsetX: followOffset().x, offsetY: -120, duration: 1200 });
    } else drawProgress(route, prog.seg, prog.along, offerGone);
    announce(parts);
    setTrip((x) =>
      x
        ? {
            ...x,
            along: prog.along,
            total,
            next: offRoute ? null : next,
            then: offRoute ? null : after,
            // Un recalcul réussi entre-temps (nouveau tracé) a déjà levé l'état hors itinéraire.
            offRoute: x.route === route ? offRoute : x.offRoute,
            socNow: socNowPct,
            speedKmh: speed,
            // Hors itinéraire : la limitation de l'ancien tracé ne vaut plus.
            limitKmh: offRoute ? null : speedLimitAt(route, prog.seg),
            remainingM,
            remainingS,
            alert,
            arrived,
            gps: 'ok',
            battery,
            viaSoc,
            lowSoc,
            offer: arrived ? null : x.offer,
          }
        : x,
    );
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Perte du signal GPS (annoncée une fois, bandeau en région live)
  useEffect(() => {
    if (!trip?.guiding || trip.arrived) return;
    const timer = setInterval(() => {
      const t = tripRef.current;
      if (!t?.guiding || t.arrived || t.gps === 'unavailable') return;
      const lost = Date.now() - lastFixAt.current > GPS_LOST_MS;
      if (lost && t.gps !== 'lost') {
        speak(tr().navx.gpsLostVoice);
        setTrip((x) => (x ? { ...x, gps: 'lost' } : x));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [trip?.guiding, trip?.arrived]);

  // Toutes les 2 minutes : perturbations du reste du trajet, heure d'arrivée avec la durée fraîche du même trajet,
  // et trajet nettement plus rapide proposé (jamais imposé). Repli client sans trafic : rien (serveur public ménagé).
  useEffect(() => {
    if (!trip?.guiding || trip.arrived || trip.client) return;
    const timer = setInterval(async () => {
      const t = tripRef.current;
      const p = prevFix.current;
      if (!t?.guiding || !t.route || t.arrived || t.arrivedAtVia || t.offRoute || !p || inFlight.current || t.offer) return;
      inFlight.current = true;
      const id = reqId.current;
      try {
        const seg = progressNear(p, t.route.geometry, cum.current, prevAlong.current).seg;
        const rest = remainingLine(t.route.geometry, seg, p);
        const [res, f] = await Promise.all([
          t.remainingM >= 1500 ? getRoute(p, t.dest, { via: t.via, options: t.options }).catch(() => null) : Promise.resolve(null),
          getIncidents(bboxOf(rest)).catch(() => null),
        ]);
        const cur = tripRef.current;
        if (id !== reqId.current || !cur?.route || !cur.guiding || cur.arrived || cur.route !== t.route) return;
        if (f) feed.current = { ...feed.current, incidents: f.incidents };
        let next: Trip = { ...cur, ...(f ? { feedOk: f.feedOk, feedUpdatedAt: f.updatedAt } : {}) };
        if (res) {
          const chk = checkFresh(rest, cur.remainingS, routeOptions(res), declined.current);
          if (chk.same) {
            // Même trajet, durée et trafic frais depuis la position : l'heure d'arrivée suit.
            announced.current = remapAnnounced(cur.route.steps, chk.same.steps, announced.current);
            resetProgress(chk.same, true);
            next = { ...next, routes: [chk.same], selected: 0, route: chk.same, remainingS: chk.same.durationS, remainingM: chk.same.distanceM, traffic: res.traffic, provider: res.provider };
            if (lostTraffic(cur, res)) next = { ...next, toast: { text: tr().navx.trafficLost, tone: 'warn', at: Date.now() } };
          }
          if (chk.faster) {
            const def = offerDefault(cur.driverChose);
            const min = Math.max(1, Math.round(chk.faster.gainS / 60));
            next = { ...next, offer: { route: chk.faster.route, gainS: chk.faster.gainS, deadline: Date.now() + OFFER_MS, def } };
            speak(tr().navx.offerVoice(min, def === 'take'));
          }
        }
        commit(await annotate(next));
      } catch {
        /* nouvel essai dans 2 min */
      } finally {
        inFlight.current = false;
      }
    }, FASTER_CHECK_MS);
    return () => clearInterval(timer);
  }, [trip?.guiding, trip?.arrived, trip?.client, annotate, commit, resetProgress]);

  // Décompte de la proposition : choix par défaut à l'échéance.
  useEffect(() => {
    const o = trip?.offer;
    if (!o) return;
    const timer = setTimeout(() => {
      // Échéance : offre caduque (trajet proposé quitté) retirée en silence, sinon choix par défaut.
      const here = prevFix.current;
      if (here && !offerStillValid(here, o)) dropOffer();
      else if (o.def === 'take') void takeOffer();
      else keepOffer();
    }, Math.max(0, o.deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [trip?.offer, takeOffer, keepOffer, dropOffer]);

  // Toasts éphémères
  useEffect(() => {
    if (!trip?.toast) return;
    const at = trip.toast.at;
    const timer = setTimeout(() => setTrip((x) => (x?.toast?.at === at ? { ...x, toast: null } : x)), 6000);
    return () => clearTimeout(timer);
  }, [trip?.toast]);

  useEffect(
    () => () => {
      watch.current?.remove();
      void keepScreenOn(false);
    },
    [],
  );

  const position: Pos | null = fix ?? user;
  return {
    trip,
    plan,
    retry,
    start,
    clear,
    setOption,
    selectRoute,
    addVia,
    removeVia,
    resumeAfterVia,
    onMapMessage,
    takeOffer,
    keepOffer,
    allowBackground,
    refuseBackground,
    position,
    gpsPos: fix,
  };
}

export type TripApi = ReturnType<typeof useTrip>;
export type { LonLat };
