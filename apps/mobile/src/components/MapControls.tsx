// Commandes de carte : boussole (nord en haut), zoom +/−, « Ma position » (recentrer + suivre, 2e appui : orientation cap).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useT } from '../i18n';

type NoteKey = 'locPending' | 'locDenied' | 'locUnavailable' | 'compassUnavailable';
import type { UserLocation } from '../lib/useLocation';
import { colors, fonts, radius } from '../theme';
import type { MapHandle } from './MapView';
import type { MapOut } from './mapHtml';

export type FollowMode = 'none' | 'follow' | 'heading';

type Pt = { lat: number; lon: number };
/** Cadrage de « Ma position » : borne conseillée à montrer avec la position, marges des contrôles et du panneau (px). */
export type LocateFrame = { target: Pt | null; pad: { top: number; bottom: number; left: number; right: number } };
const distM = (a: Pt, b: Pt) => {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  return Math.hypot(x, (b.lat - a.lat) * k) * 6_371_000;
};
/** Au-delà, la borne conseillée n'est pas cadrée (zoom trop faible pour se repérer) : recentrage simple. */
const FRAME_MAX_M = 3000;

/** État de suivi de la carte + point bleu (hors guidage). */
export function useMapControls(map: React.RefObject<MapHandle | null>, loc: UserLocation, opts: { guiding: boolean; offsetY: number; frame?: () => LocateFrame | null }) {
  const [mode, setMode] = useState<FollowMode>('none');
  const [bearing, setBearing] = useState(0);
  const [note, setNote] = useState<NoteKey | null>(null);
  const [ready, setReady] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const frameRef = useRef(opts.frame);
  frameRef.current = opts.frame;
  // Cadrage position + borne conseillée en cours (suivi sans recentrer sur la seule position) : dernière position cadrée.
  const framed = useRef<{ at: Pt; target: Pt } | null>(null);

  /** fitBounds position + borne, marges des contrôles et du panneau, zoom max 16. Faux si rien à cadrer. */
  const fit = useCallback(
    (f: Pt, duration = 700): boolean => {
      const fr = frameRef.current?.();
      if (!fr?.target || distM(f, fr.target) > FRAME_MAX_M) return false;
      const t = fr.target;
      map.current?.post({
        type: 'fit',
        bounds: [Math.min(f.lon, t.lon), Math.min(f.lat, t.lat), Math.max(f.lon, t.lon), Math.max(f.lat, t.lat)],
        ...fr.pad,
        maxZoom: 16,
        bearing: 0,
        duration,
      });
      framed.current = { at: f, target: t };
      return true;
    },
    [map],
  );

  // Point bleu, halo de précision, cône de direction ; suivi de la caméra.
  useEffect(() => {
    const f = loc.fix;
    if (!f || opts.guiding || !ready) return;
    map.current?.post({ type: 'user', lat: f.lat, lon: f.lon, accuracy: f.accuracy, heading: loc.heading });
    if (modeRef.current === 'follow' && framed.current) {
      // Cadrage conservé : recadré seulement après un déplacement notable (pas de saut à chaque mesure).
      if (distM(framed.current.at, f) > 15) fit(f, 600);
    } else if (modeRef.current !== 'none') {
      map.current?.post({ type: 'follow', lat: f.lat, lon: f.lon, bearing: modeRef.current === 'heading' ? loc.heading ?? undefined : 0, pitch: 0, offsetY: opts.offsetY, duration: 600 });
    }
  }, [loc.fix, loc.heading, opts.guiding, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loc.status === 'granted' && note !== 'compassUnavailable') setNote(null);
  }, [loc.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Messages éphémères (sauf refus : il reste tant que la position n'est pas autorisée).
  useEffect(() => {
    if (!note || note === 'locDenied') return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);

  const onMapMessage = useCallback((m: MapOut) => {
    if (m.type === 'ready') setReady(true);
    else if (m.type === 'camera') setBearing(m.bearing);
    else if (m.type === 'moveend' && m.user) {
      framed.current = null;
      setMode('none');
    }
  }, []);

  const locate = useCallback(async () => {
    if (loc.status === 'denied' || loc.status === 'unavailable') {
      setNote(loc.status === 'denied' ? 'locDenied' : 'locUnavailable');
      void loc.retry();
      return false;
    }
    if (!loc.fix) {
      setNote('locPending');
      return false;
    }
    const f = loc.fix;
    if (modeRef.current === 'follow') {
      framed.current = null;
      const ok = await loc.enableCompass();
      if (!ok && loc.heading === null) setNote('compassUnavailable');
      setMode('heading');
      map.current?.post({ type: 'follow', lat: f.lat, lon: f.lon, bearing: loc.heading ?? undefined, pitch: 0, offsetY: opts.offsetY, duration: 500 });
    } else {
      setMode('follow');
      // Position ET borne conseillée dans la partie visible de la carte ; sinon recentrage sur la position.
      if (!fit(f)) {
        framed.current = null;
        map.current?.post({ type: 'follow', lat: f.lat, lon: f.lon, bearing: 0, pitch: 0, zoom: 16, offsetY: opts.offsetY, duration: 700 });
      }
    }
    return true;
  }, [loc, map, opts.offsetY, fit]);

  const north = useCallback(() => {
    if (modeRef.current === 'heading') setMode('follow');
    map.current?.post({ type: 'north' });
  }, [map]);

  const zoom = useCallback((by: number) => map.current?.post({ type: 'zoom', by }), [map]);
  return { mode, bearing, note, setNote, onMapMessage, locate, north, zoom };
}

export type MapControlsApi = ReturnType<typeof useMapControls>;

/** Hauteurs (px) : boussole 52 + zoom 105 + « Ma position » 52 + 2 écarts de 10. */
const FULL_STACK = 52 + 10 + 105 + 10 + 52;
const SINGLE = 52;

/**
 * Commandes de carte posées entre `top` (bas des filtres) et `bottom` (haut de la fiche) : jamais de chevauchement.
 * Place suffisante : colonne complète ; sinon « Ma position » seule (et la boussole à côté si la carte est tournée) ; sinon rien.
 * Le message (refus, attente) s'affiche sous les filtres, à gauche de la colonne.
 */
export function MapControls({ api, bottom, top, left = 12, height, onLocate, status }: { api: MapControlsApi; bottom: number; top: number; left?: number; height: number; onLocate: () => void; status: UserLocation['status'] }) {
  const MAP_T = useT().mapCtl;
  const { mode, bearing } = api;
  const label = mode === 'follow' ? MAP_T.locateFollow : mode === 'heading' ? MAP_T.locateHeading : MAP_T.locate;
  const room = height - bottom - top;
  const layout: 'full' | 'compact' | 'none' = room >= FULL_STACK ? 'full' : room >= SINGLE ? 'compact' : 'none';
  const rotated = Math.abs(bearing) > 1;
  const color = mode === 'none' ? colors.position : colors.onAccent;

  const compass = (
    <Pressable accessibilityRole="button" accessibilityLabel={MAP_T.north} onPress={api.north} style={[styles.btn, styles.single]}>
      <View style={{ transform: [{ rotate: `${-bearing}deg` }] }}>
        <Svg width={30} height={30} viewBox="0 0 24 24">
          <Path d="M12 2l4 10h-8z" fill={colors.danger} />
          <Path d="M12 22l-4-10h8z" fill={colors.offline} />
          <Circle cx={12} cy={12} r={1.6} fill={colors.surface} />
        </Svg>
      </View>
    </Pressable>
  );
  const locate = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: mode !== 'none' }}
      testID="locate"
      onPress={async () => {
        if (await api.locate()) onLocate();
      }}
      style={[styles.btn, styles.single, mode !== 'none' && styles.on]}
    >
      <Svg width={28} height={28} viewBox="0 0 24 24">
        {mode === 'heading' ? (
          <Path d="M12 2l7 19-7-4-7 4z" fill={colors.onAccent} />
        ) : (
          <>
            <Circle cx={12} cy={12} r={7} stroke={color} strokeWidth={2.2} fill="none" />
            <Circle cx={12} cy={12} r={3} fill={color} />
            <Path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          </>
        )}
      </Svg>
    </Pressable>
  );

  return (
    <>
      {api.note ? (
        <View style={[styles.note, { top, left, maxHeight: Math.max(120, height - top - bottom) }]} accessibilityLiveRegion="polite" testID="map-note">
          <Text style={styles.noteText}>{MAP_T[api.note]}</Text>
          {status === 'denied' || status === 'unavailable' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={MAP_T.retry} onPress={() => api.locate()} style={({ pressed }) => [styles.noteBtn, pressed && { backgroundColor: colors.accentPressed }]}>
              <Text style={styles.noteBtnText}>{MAP_T.retry}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {layout === 'none' ? null : (
        <View style={[styles.col, { bottom }]} pointerEvents="box-none" testID={`map-controls-${layout}`}>
          {layout === 'full' ? (
            <View style={styles.stack} pointerEvents="box-none">
              {compass}
              <View style={styles.group}>
                <Pressable accessibilityRole="button" accessibilityLabel={MAP_T.zoomIn} onPress={() => api.zoom(1)} style={styles.btn}>
                  <Text style={styles.pm}>+</Text>
                </Pressable>
                <View style={styles.sep} />
                <Pressable accessibilityRole="button" accessibilityLabel={MAP_T.zoomOut} onPress={() => api.zoom(-1)} style={styles.btn}>
                  <Text style={styles.pm}>−</Text>
                </Pressable>
              </View>
              {locate}
            </View>
          ) : (
            <View style={styles.row} pointerEvents="box-none">
              {rotated ? compass : null}
              {locate}
            </View>
          )}
        </View>
      )}
    </>
  );
}

const shadow = { shadowColor: colors.ink, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 };
const styles = StyleSheet.create({
  col: { position: 'absolute', right: 12 },
  stack: { alignItems: 'center', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  single: { borderRadius: 26, ...shadow },
  group: { borderRadius: 26, overflow: 'hidden', backgroundColor: colors.surface, ...shadow },
  sep: { height: 1, backgroundColor: colors.border, marginHorizontal: 10 },
  pm: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.ink },
  on: { backgroundColor: colors.position },
  note: { position: 'absolute', left: 12, right: 12 + 52 + 10, maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, gap: 8, borderWidth: 2, borderColor: colors.busy, overflow: 'hidden', ...shadow },
  noteText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink },
  noteBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.accent },
  noteBtnText: { fontFamily: fonts.bold, fontSize: 14, color: colors.onAccent },
});
