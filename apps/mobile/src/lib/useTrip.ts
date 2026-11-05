import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapHandle } from '../components/MapView';
import { apiEnabled } from './api';
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
  type DangerZone,
  type Incident,
  type Route,
} from './navigation';
import { displayName, type Station } from './stations';

type Pos = { lat: number; lon: number };
export type RouteIncident = Incident & { alongM: number };
export type RouteZone = DangerZone & { alongM: number };

export interface Trip {
  dest: Station;
  route: Route | null;
  loading: boolean;
  error: string | null;
  incidents: RouteIncident[];
  zones: RouteZone[];
  guiding: boolean;
  along: number;
  total: number;
  nextStep: { instruction: string; inM: number } | null;
  alert: { text: string; tone: 'danger' | 'incident' } | null;
  arrived: boolean;
}

const OFF_ROUTE_M = 80;
const ALERT_AHEAD_M = 2000;

function speak(text: string) {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'fr-FR', rate: 1.0 });
  } catch {
    /* synthèse vocale indisponible */
  }
}

export function useTrip(map: React.RefObject<MapHandle | null>, user: Pos | null, sheetH: number) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const stepsAlong = useRef<number[]>([]);
  const announced = useRef(new Set<string>());
  const lastReroute = useRef(0);
  const offCount = useRef(0);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const [gpsPos, setGpsPos] = useState<Pos | null>(null);
  const prevPos = useRef<Pos | null>(null);

  const drawAndAnnotate = useCallback(
    async (dest: Station, from: Pos, keepGuiding: boolean) => {
      setTrip((t) => ({
        dest,
        route: t?.dest.id === dest.id ? t.route : null,
        loading: true,
        error: null,
        incidents: t?.incidents ?? [],
        zones: t?.zones ?? [],
        guiding: keepGuiding,
        along: 0,
        total: 0,
        nextStep: null,
        alert: null,
        arrived: false,
      }));
      try {
        if (!apiEnabled()) throw new Error('Service d’itinéraire non configuré.');
        const route = await getRoute(from, dest);
        const line = route.geometry;
        // Abscisse de chaque étape le long du trajet (pour la consigne suivante)
        stepsAlong.current = route.steps.map((s) => progressOnRoute(s, line).along);
        map.current?.post({ type: 'route', coords: line });
        if (!keepGuiding) map.current?.post({ type: 'fit', bounds: bboxOf(line, 0.002), top: 90, bottom: sheetH + 30 });
        const [inc, zones] = await Promise.all([getIncidents(bboxOf(line)).catch(() => [] as Incident[]), loadDangerZones()]);
        const onRouteInc = alongRoute(inc, line, 250);
        const onRouteZones = alongRoute(zones, line, (z) => z.radiusM);
        map.current?.post({
          type: 'incidents',
          items: onRouteInc.map((i) => ({ id: i.id, lon: i.lon, lat: i.lat, type: i.type, title: INCIDENT_LABEL[i.type] ?? i.title })),
        });
        map.current?.post({ type: 'zones', polys: onRouteZones.map((z) => circle(z)) });
        setTrip((t) =>
          t && t.dest.id === dest.id
            ? { ...t, route, loading: false, incidents: onRouteInc, zones: onRouteZones, total: progressOnRoute(dest, line).total }
            : t,
        );
      } catch (e) {
        setTrip((t) => (t ? { ...t, loading: false, error: e instanceof Error ? e.message : 'Itinéraire indisponible.' } : t));
      }
    },
    [map, sheetH],
  );

  const plan = useCallback(
    (dest: Station) => {
      if (!user) {
        setTrip({ dest, route: null, loading: false, error: 'Activez la localisation pour calculer un trajet.', incidents: [], zones: [], guiding: false, along: 0, total: 0, nextStep: null, alert: null, arrived: false });
        return;
      }
      announced.current.clear();
      drawAndAnnotate(dest, user, false);
    },
    [user, drawAndAnnotate],
  );

  const clear = useCallback(() => {
    watch.current?.remove();
    watch.current = null;
    Speech.stop();
    setTrip(null);
    setGpsPos(null);
    map.current?.post({ type: 'route', coords: [] });
    map.current?.post({ type: 'incidents', items: [] });
    map.current?.post({ type: 'zones', polys: [] });
    map.current?.post({ type: 'unfollow' });
  }, [map]);

  const start = useCallback(async () => {
    if (!trip?.route) return;
    setTrip((t) => (t ? { ...t, guiding: true } : t));
    const first = trip.route.steps[0]?.instruction;
    const delay = trip.route.trafficDelayS > 60 ? `, dont ${Math.round(trip.route.trafficDelayS / 60)} minutes de trafic` : '';
    speak(`C’est parti vers ${displayName(trip.dest)}${delay}. ${first ?? ''}`);
    try {
      watch.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 8, timeInterval: 2000 },
        (p) => setGpsPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
      );
    } catch {
      setTrip((t) => (t ? { ...t, error: 'Suivi GPS indisponible.' } : t));
    }
  }, [trip]);

  // Guidage : progression, consigne suivante, alertes, recalcul hors trajet
  useEffect(() => {
    const p = gpsPos;
    if (!p || !trip?.guiding || !trip.route) return;
    const line = trip.route.geometry;
    const prog = progressOnRoute(p, line);
    const heading = prevPos.current && metersBetween(prevPos.current, p) > 3 ? bearing(prevPos.current, p) : undefined;
    prevPos.current = p;
    map.current?.post({ type: 'user', ...p });
    map.current?.post({ type: 'follow', ...p, bearing: heading, offsetY: sheetH * 0.25 });

    if (prog.off > OFF_ROUTE_M) offCount.current += 1;
    else offCount.current = 0;
    if (offCount.current >= 2 && Date.now() - lastReroute.current > 15000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      speak('Nouvel itinéraire.');
      drawAndAnnotate(trip.dest, p, true);
      return;
    }

    const idx = stepsAlong.current.findIndex((a) => a > prog.along + 10);
    const step = idx >= 0 ? trip.route.steps[idx] : null;
    const nextStep = step ? { instruction: step.instruction, inM: Math.max(0, stepsAlong.current[idx] - prog.along) } : null;
    if (step && nextStep && nextStep.inM < 250 && !announced.current.has(`s${idx}`)) {
      announced.current.add(`s${idx}`);
      speak(`Dans ${distText(nextStep.inM)}, ${step.instruction}`);
    }

    let alert: Trip['alert'] = null;
    const zone = trip.zones.find((z) => metersBetween(p, z) <= z.radiusM);
    if (zone) {
      alert = { text: 'Zone de danger : soyez vigilant et respectez les limitations.', tone: 'danger' };
      if (!announced.current.has(`z${zone.id}`)) {
        announced.current.add(`z${zone.id}`);
        speak('Zone de danger.');
      }
    }
    const ahead = trip.incidents.find((i) => i.alongM > prog.along && i.alongM - prog.along < ALERT_AHEAD_M);
    if (ahead) {
      const label = INCIDENT_LABEL[ahead.type] ?? 'Perturbation';
      alert = alert ?? { text: `${label} dans ${distText(ahead.alongM - prog.along)}`, tone: 'incident' };
      if (!announced.current.has(`i${ahead.id}`)) {
        announced.current.add(`i${ahead.id}`);
        speak(`${label} dans ${distText(ahead.alongM - prog.along)}.`);
      }
    }
    const remaining = prog.total - prog.along;
    const arrived = remaining < 30 || metersBetween(p, trip.dest) < 40;
    if (arrived && !trip.arrived) speak(`Vous êtes arrivé. Vous pouvez payer la borne depuis Branché.`);
    setTrip((t) => (t ? { ...t, along: prog.along, total: prog.total, nextStep, alert, arrived } : t));
  }, [gpsPos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => watch.current?.remove(), []);

  return { trip, plan, start, clear, gpsPos };
}
