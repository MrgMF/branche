import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapView, type MapHandle } from '../components/MapView';
import type { MapOut } from '../components/mapHtml';
import { StationDetail } from '../components/StationDetail';
import { ChargeShortcuts, HereBanner } from '../components/HereBanner';
import { TripPanel } from '../components/TripPanel';
import { Guidance } from '../components/Guidance';
import { SearchBar } from '../components/SearchBar';
import { useRechargeHere } from '../lib/useRechargeHere';
import { Chip, Notice } from '../components/ui';
import { apiEnabled, getConfigWithRetry, type ApiConfig } from '../lib/api';
import { DEFAULT_CENTER } from '../lib/config';
import { km, kw, minutes, PLUG_LABEL } from '../lib/format';
import { operatorLabel } from '../lib/connectors';
import type { Operator } from '../lib/qr';
import { applyFilters, displayName, distanceKm, loadAround, loadOperators, nearest, NO_FILTERS, type Filters, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { placeDest, stationDest, useTrip } from '../lib/useTrip';
import { useUserLocation } from '../lib/useLocation';
import { MapControls, useMapControls } from '../components/MapControls';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

type Pos = { lat: number; lon: number };
type LocState = 'pending' | 'granted' | 'denied';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const wide = width >= 768;
  const map = useRef<MapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  // Position en continu (point bleu, précision, cap) — src/lib/useLocation.ts
  const geo = useUserLocation();
  const loc: LocState = geo.status === 'granted' || geo.coarse ? 'granted' : geo.status === 'pending' ? 'pending' : 'denied';
  const user: Pos | null = geo.coarse;
  const [center, setCenter] = useState<Pos>(DEFAULT_CENTER);
  const [byId, setById] = useState<Map<string, Station>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [api, setApi] = useState<ApiConfig | null>(null);
  const [apiError, setApiError] = useState(false);
  const [apiLoading, setApiLoading] = useState(apiEnabled());
  const loadedFor = useRef<string>('');
  const [ops, setOps] = useState<Operator[]>([]);
  const [resume, setResume] = useState<string | null>(null);

  useEffect(() => {
    store.loadDirect().then((d) => setResume(d && !d.endedAt ? d.operatorName : null));
  }, []);

  useEffect(() => {
    loadOperators().then(setOps);
  }, []);

  // Configuration du paiement
  useEffect(() => {
    if (!apiEnabled()) return;
    getConfigWithRetry()
      .then(setApi)
      .catch(() => setApiError(true))
      .finally(() => setApiLoading(false));
  }, []);

  // Retour arrière (Android) et Échap (web) ferment la fiche au lieu de quitter l'app
  useEffect(() => {
    if (!selectedId) return;
    if (Platform.OS === 'web') {
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null);
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedId(null);
      return true;
    });
    return () => sub.remove();
  }, [selectedId]);


  // Centre de recherche : position, puis centre de la carte quand l'utilisateur la déplace
  const [panned, setPanned] = useState(false);
  const ref: Pos = !panned && user ? user : center;

  const load = useCallback(async (p: Pos) => {
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setLoading(true);
    try {
      const list = await loadAround(p, 1);
      setById((prev) => {
        const next = new Map(prev);
        for (const s of list) next.set(s.id, s);
        return next;
      });
      setDataError(false);
    } catch {
      loadedFor.current = '';
      setDataError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loc === 'pending' && !user) return;
    load(ref);
  }, [ref.lat, ref.lon, loc, user, load]);

  const all = useMemo(() => [...byId.values()], [byId]);
  const visible = useMemo(() => applyFilters(all, filters), [all, filters]);
  const closest = useMemo(() => nearest(visible, ref, 5), [visible, ref.lat, ref.lon]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const nav = useTrip(map, geo.fix ?? user, Math.round(height * 0.55));
  const { trip, plan } = nav;
  const rechargeHere = useRechargeHere();
  const [searching, setSearching] = useState(false);
  const controls = useMapControls(map, geo, { guiding: !!trip?.guiding, offsetY: wide ? 0 : -height * 0.18 });
  const sheetMax = Math.round(height * (trip ? 0.58 : selected ? 0.62 : 0.46));

  useEffect(() => {
    store.setStations(all);
  }, [all]);
  useEffect(() => {
    store.setCurrent(selected);
  }, [selected]);

  // Synchronisation carte
  useEffect(() => {
    if (!mapReady) return;
    map.current?.post({
      type: 'stations',
      stations: visible.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, kw: s.kw, r: s.acc === 'reserve', label: s.kw ? kw(s.kw) : '' })),
    });
  }, [visible, mapReady]);

  // Premier centrage sur la position ; ensuite, recentrage/suivi via « Ma position » (MapControls).
  const flown = useRef(false);
  useEffect(() => {
    if (!mapReady || !user || flown.current) return;
    flown.current = true;
    if (!panned && !selectedId) map.current?.post({ type: 'fly', ...user, zoom: 14, offsetY: -height * 0.18 });
  }, [user, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapReady) map.current?.post({ type: 'select', id: selectedId });
  }, [selectedId, mapReady]);

  function onMap(m: MapOut) {
    controls.onMapMessage(m);
    if (m.type === 'ready') {
      setMapReady(true);
      if (!user) map.current?.post({ type: 'fly', ...DEFAULT_CENTER, zoom: 12, instant: true });
    } else if (m.type === 'tapRoute' || m.type === 'tapPin') nav.onMapMessage(m);
    else if (m.type === 'tap') {
      if (!trip) setSelectedId(m.id);
    }
    else if (m.type === 'moveend' && m.user) {
      setCenter({ lat: m.lat, lon: m.lon });
      if (user && distanceKm(user, m) > 2) setPanned(true);
    }
  }

  function select(s: Station) {
    setSelectedId(s.id);
    map.current?.post({ type: 'fly', lat: s.lat, lon: s.lon, zoom: 15, offsetY: -height * 0.25 });
  }

  function recenter() {
    setPanned(false);
    setSelectedId(null);
    if (user) map.current?.post({ type: 'fly', ...user, zoom: 14, offsetY: -height * 0.18 });
  }

  const toggle = (k: keyof Filters) => setFilters((f) => ({ ...f, [k]: !f[k] }));

  return (
    <View style={styles.root}>
      <MapView ref={map} onMessage={onMap} />

      <View style={[styles.top, { paddingTop: insets.top + 10 }, trip?.guiding ? { display: 'none' } : null, { flexDirection: 'column', alignItems: 'stretch', zIndex: 5 }, wide && { right: undefined, width: 440 }]} pointerEvents="box-none">
        <SearchBar
          near={user ?? (panned ? center : null)}
          onFocusChange={setSearching}
          onSelect={(p) => {
            setSelectedId(null);
            // Adresse d'une borne connue : la destination devient la borne (arrivée → recharge).
            const st = all.find((s) => distanceKm(s, p) < 0.04);
            plan(st ? { ...stationDest(st), name: displayName(st) } : placeDest(p));
          }}
        />
        <ScrollView horizontal style={[{ flexGrow: 0 }, searching || trip ? { display: 'none' } : null]} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Filtres">
          <Chip label="Rapide" a11y="Rapide, 50 kW et plus" active={filters.fast} onPress={() => toggle('fast')} />
          <Chip label="CCS" active={filters.ccs} onPress={() => toggle('ccs')} />
          <Chip label="Type 2" active={filters.t2} onPress={() => toggle('t2')} />
          <Chip label="Accès libre" active={filters.open} onPress={() => toggle('open')} />
        </ScrollView>
      </View>

      {!trip?.guiding && !searching ? (
        <MapControls
          api={controls}
          status={geo.status}
          bottom={wide ? 24 : sheetMax + 12}
          onLocate={() => {
            setPanned(false);
            setSelectedId(null);
          }}
        />
      ) : null}

      {trip?.guiding ? <Guidance nav={nav} onRecharge={rechargeHere} /> : null}
      <View style={[styles.sheet, wide && styles.sheetWide, { maxHeight: sheetMax, paddingBottom: insets.bottom + 12 }, trip?.guiding ? { display: 'none' } : null]}>
        <View style={styles.grip} />
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {trip ? (
            <TripPanel nav={nav} />
          ) : selected ? (
            <StationDetail
              station={selected}
              distance={user ? distanceKm(user, selected) : null}
              api={api}
              apiError={apiError}
              apiLoading={apiLoading}
              operatorName={operatorLabel(selected, ops)}
              onRoute={() => plan(selected)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <>
              <View style={styles.titleRow}>
                <Text style={[styles.h1, { flex: 1 }]} accessibilityRole="header">
                  {panned || !user ? 'Bornes autour de la carte' : 'Bornes les plus proches'}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="À propos et mentions légales" onPress={() => router.push('/about')} style={styles.infoBtn}>
                  <Text style={styles.roundText}>i</Text>
                </Pressable>
              </View>
              <ChargeShortcuts />
              {resume ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/recharge')} style={styles.resume}>
                  <Text style={styles.resumeText}>Recharge en cours chez {resume} · Reprendre</Text>
                </Pressable>
              ) : (
                <HereBanner user={user} />
              )}
              {loc === 'denied' && !panned ? (
                <Notice>Position non autorisée : déplacez la carte vers votre zone ou autorisez la localisation dans les réglages.</Notice>
              ) : null}
              {dataError ? <Notice tone="error">Impossible de charger les bornes. Vérifiez votre connexion puis déplacez la carte pour réessayer.</Notice> : null}
              {loading && !closest.length ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.muted}>{loc === 'pending' ? 'Localisation en cours…' : 'Chargement des bornes…'}</Text>
                </View>
              ) : null}
              {!loading && !dataError && !closest.length ? (
                <Text style={styles.muted}>Aucune borne trouvée ici avec ces filtres.</Text>
              ) : null}
              {closest.map(({ s, d }, i) => (
                <Pressable
                  key={s.id}
                  onPress={() => select(s)}
                  accessibilityRole="button"
                  accessibilityLabel={`${displayName(s)}, à ${km(d)}, ${kw(s.kw)}`}
                  style={({ pressed }) => [styles.item, i === 0 && styles.itemFirst, pressed && { backgroundColor: colors.surfaceAlt }]}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {displayName(s)}
                    </Text>
                    <Text style={styles.itemSub} numberOfLines={1}>
                      {[kw(s.kw), s.c.map((c) => PLUG_LABEL[c]).join(', '), s.acc === 'reserve' ? 'Accès réservé' : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.dist}>{km(d)}</Text>
                    <Text style={styles.itemSub}>{minutes(d)}</Text>
                  </View>
                </Pressable>
              ))}
              {Platform.OS === 'web' ? <Text style={styles.small}>Astuce : sur téléphone, ajoutez cette page à l’écran d’accueil.</Text> : null}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.mapGround },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  chips: { gap: 8, paddingRight: 8 },
  round: {
    width: MIN_TOUCH + 4,
    height: MIN_TOUCH + 4,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F1A17',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  roundText: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  recenter: { position: 'absolute', right: 16 },
  target: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#1D4ED8' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 18,
    paddingTop: 8,
    shadowColor: '#0F1A17',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  sheetWide: { right: undefined, width: 440, left: 16, bottom: 16, borderRadius: radius.xl },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#C9D3D0', marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoBtn: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  resume: { minHeight: MIN_TOUCH, borderRadius: radius.md, backgroundColor: colors.ink, justifyContent: 'center', paddingHorizontal: 14 },
  resumeText: { fontFamily: fonts.semibold, fontSize: 15, color: '#FFFFFF' },
  h1: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minHeight: 64 },
  itemFirst: { borderColor: colors.accent, borderWidth: 2 },
  itemTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  itemSub: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkMuted },
  dist: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
