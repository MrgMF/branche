import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapHandle } from '../components/MapView';
import type { MapOut } from '../components/mapHtml';
import { apiEnabled } from './api';
import {
  announcementText,
  arrivalSoc,
  chargersOnRoute,
  deltaText,
  fasterRoute,
  LOW_SOC,
  maneuverOf,
  nextStepIndex,
  pickAnnouncement,
  remainingLine,
  speedKmh as computeSpeed,
  speedLimitAt,
  stepsAlong,
  tileProbes,
  trafficSegments,
  type ChargerSuggestion,
} from './guidance';
import { watchGeo } from './geoWatch';
import { keepScreenOn } from './keepAwake';
import {
  alongRoute,
  bboxOf,
  bearing,
  circle,
  distText,
  getIncidents,
  getRoute,
  INCIDENT_LABEL,
  loadDangerZones,
  metersBetween,
  progressOnRoute,
  routeOptions,
  type DangerZone,
  type Incident,
  type LonLat,
  type Place,
  type RouteOption,
  type RouteOptions,
  type RouteStep,
} from './navigation';
import { displayName, loadAround, type Station } from './stations';
import { loadVehicle, socAfter, type Vehicle } from './vehicle';
import { loadVoicePref, speak, stopSpeaking } from './voice';

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
export const stationDest = (s: Station): Destination => ({ id: s.id, name: displayName(s), sub: s.a, lat: s.lat, lon: s.lon, station: s });
export const placeDest = (p: Place): Destination => ({ id: `p:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`, name: p.label, sub: p.sublabel, lat: p.lat, lon: p.lon });

export type GpsState = 'ok' | 'waiting' | 'lost' | 'unavailable';

export interface Trip {
  dest: Destination;
  via: Destination[];
  options: RouteOptions;
  provider: 'tomtom' | 'valhalla' | null;
  traffic: boolean;
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
  /** Batterie estimée à l'arrivée par trajet (id → %), si un véhicule est enregistré. */
  battery: Record<string, number> | null;
  vehicleName: string | null;
  chargers: ChargerSuggestion[];
  rerouting: boolean;
}

const NO_OPTIONS: RouteOptions = { avoidTolls: false, avoidMotorways: false };
const ALERT_AHEAD_M = 2000;
const FASTER_CHECK_MS = 120_000;
const GPS_LOST_MS = 12_000;

const blank = (dest: Destination, over: Partial<Trip> = {}): Trip => ({
  dest,
  via: [],
  options: NO_OPTIONS,
  provider: null,
  traffic: false,
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
  ...over,
});

type Fix = { lat: number; lon: number; t: number; speed: number | null; heading: number | null; accuracy: number | null };

export function useTrip(map: React.RefObject<MapHandle | null>, user: Pos | null, sheetH: number) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const tripRef = useRef<Trip | null>(null);
  tripRef.current = trip;
  const along = useRef<number[]>([]);
  const announced = useRef(new Set<string>());
  const lastReroute = useRef(0);
  const inFlight = useRef(false);
  const offCount = useRef(0);
  const watch = useRef<{ remove: () => void } | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const prevFix = useRef<Fix | null>(null);
  const lastBearing = useRef<number | undefined>(undefined);
  const lastFixAt = useRef(0);
  const feed = useRef<{ incidents: Incident[]; zones: DangerZone[] }>({ incidents: [], zones: [] });
  const vehicle = useRef<Vehicle | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    void loadVoicePref();
  }, []);

  // ---------------------------------------------------------------- carte
  const draw = useCallback(
    (t: Trip) => {
      const r = t.route;
      if (!r) return;
      const best = t.routes[0];
      map.current?.post({
        type: 'routes',
        main: r.geometry,
        segments: trafficSegments(r),
        alts: t.guiding
          ? []
          : t.routes
              .map((x, i) => ({ x, i }))
              .filter(({ i }) => i !== t.selected)
              .map(({ x }) => ({ id: x.id, coords: x.geometry, label: best ? (x.id === best.id ? 'Le plus rapide' : deltaText(x.durationS - best.durationS)) : '' })),
      });
      map.current?.post({ type: 'dest', lat: t.dest.lat, lon: t.dest.lon });
      const pins = t.guiding ? t.via : t.chargers.map((c) => ({ id: c.station.id, name: `${Math.round(c.station.kw)} kW`, lat: c.station.lat, lon: c.station.lon }));
      map.current?.post({ type: 'pins', items: [...pins, ...(t.guiding ? [] : t.via)].map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: p.name })) });
      map.current?.post({
        type: 'incidents',
        items: t.incidents.map((i) => ({ id: i.id, lon: i.lon, lat: i.lat, type: i.type, title: INCIDENT_LABEL[i.type] ?? i.title })),
      });
      map.current?.post({ type: 'zones', polys: t.zones.map((z) => circle(z)) });
    },
    [map],
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
    let chargers: ChargerSuggestion[] = [];
    if (v) {
      battery = Object.fromEntries(t.routes.map((x) => [x.id, arrivalSoc(v, socAfter, x.distanceM, x.durationS)]));
      if ((battery[r.id] ?? 100) < LOW_SOC && !t.guiding) {
        const lists = await Promise.all(tileProbes(line).map((p) => loadAround(p, 0).catch(() => [] as Station[])));
        chargers = chargersOnRoute(lists.flat(), line, v, socAfter, r.distanceM).filter((c) => !t.via.some((x) => x.id === c.station.id));
      }
    }
    return { ...t, incidents, zones, battery, vehicleName: v?.name ?? null, chargers, total: progressOnRoute(t.dest, line).total };
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
        if (!apiEnabled()) throw new Error('Service d’itinéraire non configuré.');
        vehicle.current = await loadVehicle().catch(() => null);
        const res = await getRoute(from, base.dest, { via: base.via, options: base.options });
        if (id !== reqId.current) return;
        let routes = routeOptions(res);
        if (mode === 'reroute') routes = routes.slice(0, 1);
        const all = routes.flatMap((r) => r.geometry);
        if (mode === 'preview') map.current?.post({ type: 'fit', bounds: bboxOf(all, 0.002), top: 150, bottom: sheetH + 30 });
        const [f, zones] = await Promise.all([
          getIncidents(bboxOf(all)).catch(() => ({ incidents: [] as Incident[], feedOk: false, updatedAt: null })),
          loadDangerZones(),
        ]);
        if (id !== reqId.current) return;
        feed.current = { incidents: f.incidents, zones };
        const route = routes[0] ?? null;
        if (route) along.current = stepsAlong(route);
        if (mode === 'reroute') announced.current.clear();
        const next = await annotate({
          ...base,
          provider: res.provider,
          traffic: res.traffic,
          routes,
          selected: 0,
          route,
          loading: false,
          rerouting: false,
          feedOk: f.feedOk,
          feedUpdatedAt: f.updatedAt,
          toast: mode === 'reroute' ? { text: 'Nouvel itinéraire calculé', tone: 'info', at: Date.now() } : base.toast,
        });
        if (id !== reqId.current) return;
        commit(next);
      } catch (e) {
        if (id !== reqId.current) return;
        const msg = e instanceof Error ? e.message : 'Itinéraire indisponible.';
        // En guidage, on garde l'ancien tracé : un recalcul raté n'interrompt pas la conduite.
        setTrip((t) => (t ? (mode === 'reroute' && t.route ? { ...t, loading: false, rerouting: false, toast: { text: 'Recalcul impossible pour le moment, nouvel essai bientôt.', tone: 'warn', at: Date.now() } } : { ...t, loading: false, rerouting: false, error: msg }) : t));
      } finally {
        inFlight.current = false;
      }
    },
    [annotate, commit, map, sheetH],
  );

  const plan = useCallback(
    (d: Station | Destination) => {
      const dest = 'station' in d || 'name' in d ? (d as Destination) : stationDest(d as Station);
      announced.current.clear();
      const prev = tripRef.current;
      const base = blank(dest, { options: prev?.options ?? NO_OPTIONS, routes: prev?.dest.id === dest.id ? prev.routes : [] });
      if (!user) {
        setTrip({ ...base, error: 'Position inconnue : activez la localisation pour calculer un trajet.', gps: 'unavailable' });
        return;
      }
      void compute(base, user, 'preview');
    },
    [user, compute],
  );

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
      along.current = stepsAlong(route);
      commit(await annotate({ ...t, selected: i, route }));
    },
    [annotate, commit],
  );

  const addVia = useCallback(
    (s: Station) => {
      const t = tripRef.current;
      if (!t || !user) return;
      void compute({ ...t, via: [stationDest(s)], chargers: [] }, user, 'preview');
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
      watch.current = await watchGeo(setFix, (code) => code === 'denied' && setTrip((t) => (t ? { ...t, gps: 'unavailable' } : t)));
    } catch {
      setTrip((t) => (t ? { ...t, gps: 'unavailable' } : t));
    }
  }, [stopWatch]);

  const start = useCallback(async () => {
    const t = tripRef.current;
    if (!t?.route) return;
    lastFixAt.current = Date.now();
    const g = { ...t, guiding: true, gps: 'waiting' as GpsState, toast: null };
    commit(g);
    void keepScreenOn(true);
    const first = t.route.steps.find((s) => maneuverOf(s) !== 'depart') ?? t.route.steps[0];
    const delay = t.traffic && t.route.trafficDelayS > 60 ? `, dont ${Math.round(t.route.trafficDelayS / 60)} minutes de trafic` : '';
    speak(`C’est parti vers ${t.dest.name}${delay}.${first ? ` ${first.instruction}` : ''}`);
    await startWatch();
  }, [commit, startWatch]);

  /** Arrivé à une étape (borne) : reprendre vers la destination finale. */
  const resumeAfterVia = useCallback(() => {
    const t = tripRef.current;
    const p = fix ?? user;
    if (!t || !p) return;
    lastReroute.current = Date.now();
    void compute({ ...t, via: t.via.slice(1), arrivedAtVia: null, guiding: true }, p, 'reroute');
    if (!watch.current) void startWatch();
    void keepScreenOn(true);
  }, [compute, fix, user, startWatch]);

  const onMapMessage = useCallback(
    (m: MapOut) => {
      if (m.type === 'tapRoute') void selectRoute(m.id);
      else if (m.type === 'tapPin') {
        const c = tripRef.current?.chargers.find((x) => x.station.id === m.id);
        if (c) addVia(c.station);
      }
    },
    [selectRoute, addVia],
  );

  // ---------------------------------------------------------------- guidage
  useEffect(() => {
    const p = fix;
    const t = tripRef.current;
    if (!p || !t?.guiding || !t.route || t.arrived || t.arrivedAtVia) return;
    lastFixAt.current = Date.now();
    const route = t.route;
    const line = route.geometry;
    const prog = progressOnRoute(p, line);
    const prev = prevFix.current;
    const speed = computeSpeed(p.speed, prev, p);
    if (p.heading !== null && p.heading >= 0 && (speed ?? 0) > 5) lastBearing.current = p.heading;
    else if (prev && metersBetween(prev, p) > 4) lastBearing.current = bearing(prev, p);
    prevFix.current = p;
    const zoom = (speed ?? 0) > 80 ? 15 : (speed ?? 0) > 45 ? 16 : 17;
    map.current?.post({ type: 'user', lat: p.lat, lon: p.lon, bearing: lastBearing.current, nav: true });
    map.current?.post({ type: 'follow', lat: p.lat, lon: p.lon, bearing: lastBearing.current, zoom, offsetY: 150 });

    // Hors trajet : 2 positions consécutives au-delà de la tolérance (précision GPS comprise).
    const tol = Math.max(45, Math.min(p.accuracy ?? 20, 60) + 30);
    if ((p.accuracy ?? 0) <= 100) offCount.current = prog.off > tol ? offCount.current + 1 : 0;
    if (offCount.current >= 2 && !inFlight.current && Date.now() - lastReroute.current > 10_000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      inFlight.current = true;
      speak('Nouvel itinéraire.');
      void compute({ ...t }, p, 'reroute');
      return;
    }

    // Étape (borne) atteinte
    const via = t.via[0];
    if (via && metersBetween(p, via) < 50) {
      speak(`Vous êtes arrivé à votre étape, ${via.name}.`);
      setTrip((x) => (x ? { ...x, arrivedAtVia: via, speedKmh: speed } : x));
      map.current?.post({ type: 'unfollow' });
      return;
    }

    const idx = nextStepIndex(along.current, route.steps, prog.along);
    const step = idx >= 0 ? route.steps[idx] : null;
    const inM = step ? Math.max(0, along.current[idx] - prog.along) : 0;
    const next = step ? { step, index: idx, inM } : null;
    const after = idx >= 0 && idx + 1 < route.steps.length ? { step: route.steps[idx + 1], gapM: along.current[idx + 1] - along.current[idx] } : null;
    if (step) {
      const legM = idx > 0 ? along.current[idx] - along.current[idx - 1] : along.current[idx];
      const level = pickAnnouncement(idx, inM, legM, speed, announced.current);
      if (level && maneuverOf(step) !== 'arrive') speak(announcementText(level, inM, step, after ?? undefined));
      else if (level && maneuverOf(step) === 'arrive' && level !== 'near') speak(`Dans ${distText(inM)}, vous serez arrivé.`);
    }

    let alert: Trip['alert'] = null;
    const zone = t.zones.find((z) => metersBetween(p, z) <= z.radiusM);
    if (zone) {
      alert = { text: 'Zone de danger : soyez vigilant et respectez les limitations.', tone: 'danger' };
      if (!announced.current.has(`z${zone.id}`)) {
        announced.current.add(`z${zone.id}`);
        speak('Zone de danger.');
      }
    }
    const ahead = t.incidents.find((i) => i.alongM > prog.along && i.alongM - prog.along < ALERT_AHEAD_M);
    if (ahead) {
      const label = INCIDENT_LABEL[ahead.type] ?? 'Perturbation';
      alert = alert ?? { text: `${label} dans ${distText(ahead.alongM - prog.along)}`, tone: 'incident' };
      if (!announced.current.has(`i${ahead.id}`)) {
        announced.current.add(`i${ahead.id}`);
        speak(`${label} signalé dans ${distText(ahead.alongM - prog.along)}.`);
      }
    }
    const total = prog.total || route.distanceM;
    const remainingM = Math.max(0, total - prog.along);
    const remainingS = route.durationS * (total ? remainingM / total : 1);
    const arrived = remainingM < 30 || metersBetween(p, t.dest) < 40;
    if (arrived) {
      speak(t.dest.station ? `Vous êtes arrivé à ${t.dest.name}. Vous pouvez lancer la recharge depuis Branché.` : `Vous êtes arrivé à ${t.dest.name}.`);
      stopWatch();
      void keepScreenOn(false);
      map.current?.post({ type: 'unfollow' });
    }
    setTrip((x) =>
      x
        ? {
            ...x,
            along: prog.along,
            total,
            next,
            then: after,
            speedKmh: speed,
            limitKmh: speedLimitAt(route, prog.seg),
            remainingM,
            remainingS,
            alert,
            arrived,
            gps: 'ok',
          }
        : x,
    );
  }, [fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Perte du signal GPS
  useEffect(() => {
    if (!trip?.guiding || trip.arrived) return;
    const timer = setInterval(() => {
      const t = tripRef.current;
      if (!t?.guiding || t.arrived || t.gps === 'unavailable') return;
      const lost = Date.now() - lastFixAt.current > GPS_LOST_MS;
      if (lost && t.gps !== 'lost') setTrip((x) => (x ? { ...x, gps: 'lost' } : x));
    }, 3000);
    return () => clearInterval(timer);
  }, [trip?.guiding, trip?.arrived]);

  // Trajet plus rapide : nouvelle vérification toutes les 2 minutes pendant le guidage.
  useEffect(() => {
    if (!trip?.guiding || trip.arrived) return;
    const timer = setInterval(async () => {
      const t = tripRef.current;
      const p = prevFix.current;
      if (!t?.guiding || !t.route || t.arrived || t.arrivedAtVia || !p || inFlight.current || t.remainingM < 2000) return;
      inFlight.current = true;
      const id = reqId.current;
      try {
        const res = await getRoute(p, t.dest, { via: t.via, options: t.options });
        const cur = tripRef.current;
        if (id !== reqId.current || !cur?.route || !cur.guiding) return;
        const seg = progressOnRoute(p, cur.route.geometry).seg;
        const better = fasterRoute(remainingLine(cur.route.geometry, seg, p), cur.remainingS, routeOptions(res));
        if (!better) return;
        const min = Math.round(better.gainS / 60);
        along.current = stepsAlong(better.route);
        announced.current.clear();
        speak(`Trajet plus rapide trouvé : vous gagnez ${min} minutes.`);
        commit(
          await annotate({
            ...cur,
            routes: [better.route],
            selected: 0,
            route: better.route,
            toast: { text: `Trajet plus rapide : ${min} min gagnées`, tone: 'success', at: Date.now() },
          }),
        );
      } catch {
        /* nouvel essai dans 2 min */
      } finally {
        inFlight.current = false;
      }
    }, FASTER_CHECK_MS);
    return () => clearInterval(timer);
  }, [trip?.guiding, trip?.arrived, annotate, commit]);

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
  return { trip, plan, start, clear, setOption, selectRoute, addVia, removeVia, resumeAfterVia, onMapMessage, position, gpsPos: fix };
}

export type TripApi = ReturnType<typeof useTrip>;
export type { LonLat };
