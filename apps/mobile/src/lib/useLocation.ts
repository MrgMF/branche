// Position de l'utilisateur en continu (point bleu, précision, cap), avec états de permission explicites.
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { watchGeo } from './geoWatch';
import { speedKmh } from './guidance';

export type LocStatus = 'pending' | 'granted' | 'denied' | 'unavailable';
export interface UserFix {
  lat: number;
  lon: number;
  accuracy: number | null;
  /** Cap (degrés, 0 = nord) : boussole si disponible, sinon direction du déplacement. */
  heading: number | null;
  speed: number | null;
  t: number;
}

const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  return Math.hypot(x, (b.lat - a.lat) * r) * 6371000;
};

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };

export function useUserLocation() {
  const [status, setStatus] = useState<LocStatus>('pending');
  const [fix, setFix] = useState<UserFix | null>(null);
  /** Position « stable » : ne change qu'après 30 m (évite de relancer chargements et recentrages). */
  const [coarse, setCoarse] = useState<{ lat: number; lon: number } | null>(null);
  const [compass, setCompass] = useState<number | null>(null);
  /** Vitesse (km/h) : coords.speed du GPS, sinon dérivée des deux dernières positions (compteur hors guidage). */
  const [kmh, setKmh] = useState<number | null>(null);
  const prevFix = useRef<UserFix | null>(null);
  const sub = useRef<{ remove: () => void } | null>(null);
  const headSub = useRef<{ remove: () => void } | null>(null);
  const lastCompass = useRef<number | null>(null);

  const onCompass = useCallback((h: number | null) => {
    if (h === null || !Number.isFinite(h)) return;
    const v = ((h % 360) + 360) % 360;
    if (lastCompass.current !== null && Math.abs(((v - lastCompass.current + 540) % 360) - 180) < 3) return;
    lastCompass.current = v;
    setCompass(Math.round(v));
  }, []);

  const start = useCallback(async () => {
    sub.current?.remove();
    sub.current = null;
    setStatus('pending');
    try {
      const { status: st } = await Location.requestForegroundPermissionsAsync();
      if (st !== 'granted') return setStatus('denied');
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) setCoarse({ lat: last.coords.latitude, lon: last.coords.longitude });
      sub.current = await watchGeo(
        (p) => {
          setStatus('granted');
          const f: UserFix = { ...p, heading: p.heading !== null && p.heading >= 0 && (p.speed ?? 0) > 1 ? p.heading : null };
          setKmh(speedKmh(p.speed, prevFix.current, f));
          prevFix.current = f;
          setFix(f);
          setCoarse((c) => (!c || dist(c, f) > 30 ? { lat: f.lat, lon: f.lon } : c));
        },
        (code) => setStatus((s) => (s === 'granted' && code === 'unavailable' ? s : code)),
        false,
      );
      if (Platform.OS !== 'web' && !headSub.current) {
        headSub.current = await Location.watchHeadingAsync((h) => onCompass(h.trueHeading >= 0 ? h.trueHeading : h.magHeading)).catch(() => null);
      }
    } catch {
      setStatus((s) => (s === 'pending' ? 'unavailable' : s));
    }
  }, [onCompass]);

  // Web : boussole (Android : deviceorientationabsolute ; iOS : webkitCompassHeading après autorisation sur un geste).
  const webListen = useRef(false);
  const enableCompass = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    try {
      if (DOE?.requestPermission && (await DOE.requestPermission()) !== 'granted') return false;
    } catch {
      return false;
    }
    if (!webListen.current) {
      webListen.current = true;
      window.addEventListener('deviceorientationabsolute', ((e: DeviceOrientationEvent) => {
        if (e.alpha !== null) onCompass(360 - e.alpha);
      }) as EventListener);
      window.addEventListener('deviceorientation', ((e: OrientationEvt) => {
        if (typeof e.webkitCompassHeading === 'number') onCompass(e.webkitCompassHeading);
      }) as EventListener);
    }
    return 'DeviceOrientationEvent' in window;
  }, [onCompass]);

  useEffect(() => {
    void start();
    return () => {
      sub.current?.remove();
      headSub.current?.remove();
    };
  }, [start]);

  const heading = compass ?? fix?.heading ?? null;
  return { status, fix, coarse, heading, speedKmh: kmh, retry: start, enableCompass };
}

export type UserLocation = ReturnType<typeof useUserLocation>;
