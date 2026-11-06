import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapView, type MapHandle } from '../components/MapView';
import type { MapOut } from '../components/mapHtml';
import { StationDetail, StationMainAction } from '../components/StationDetail';
import { ChargeShortcuts, HereBanner } from '../components/HereBanner';
import { TripFooter, TripPanel } from '../components/TripPanel';
import { Guidance, guidanceSide } from '../components/Guidance';
import { SearchBar } from '../components/SearchBar';
import { useRechargeHere } from '../lib/useRechargeHere';
import { Button, Chip, Notice } from '../components/ui';
import { availabilityDown, getAvailability, stationStatus, stationSummary, type StationStatus } from '../lib/availability';
import { groupColocated } from '../lib/colocated';
import { apiEnabled, getConfigWithRetry, type ApiConfig } from '../lib/api';
import { DEFAULT_CENTER } from '../lib/config';
import { km, kw, minutes, plugLabel } from '../lib/format';
import { operatorLabel } from '../lib/connectors';
import type { Operator } from '../lib/qr';
import { applyFilters, displayName, distanceKm, loadAround, loadOperators, nearest, NO_FILTERS, type Filters, type Station } from '../lib/stations';
import { staleUnconfirmed, store } from '../lib/store';
import { abandonUnconfirmed } from '../lib/autoEnd';
import { SaveFailed } from '../components/SaveFailed';
import { placeDest, stationDest, useTrip } from '../lib/useTrip';
import { useUserLocation } from '../lib/useLocation';
import { useGoParam } from '../lib/useGoParam';
import { MapControls, useMapControls } from '../components/MapControls';
import { AppMenu, chargeState, MenuButton, type ChargeState } from '../components/AppMenu';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { colors, fonts, mapColors, MIN_TOUCH, radius } from '../theme';
import { useLargeText } from '../lib/useLargeText';

type Pos = { lat: number; lon: number };
type LocState = 'pending' | 'granted' | 'denied';

export default function MapScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [badge, setBadge] = useState<ChargeState>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
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
  // Recharge suivie : « Paiement en attente » tant que le démarrage n'est pas confirmé, « Recharge en cours » ensuite
  const [resume, setResume] = useState<{ op: string; started: boolean } | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [staleSaveErr, setStaleSaveErr] = useState(false);
  // Mise en page mesurée : bas du bloc recherche + filtres, hauteur réelle de la fiche.
  const [topH, setTopH] = useState(insets.top + 130);
  const [sheetH, setSheetH] = useState(0);
  const [advisedId, setAdvisedId] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, StationStatus>>({});
  const [availDown, setAvailDown] = useState(false);
  const large = useLargeText();
  // Panneau : remis en haut à chaque fiche ouverte (titre et « Recharger ici » visibles sans défiler).
  const sheetScroll = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    sheetScroll.current?.scrollTo({ y: 0, animated: false });
  }, [selectedId]);

  // Au retour sur la carte : recharge en cours / préparée (badge du menu, bandeau « Reprendre »)
  useFocusEffect(
    useCallback(() => {
      store.loadDirect().then((d) => {
        setResume(d && !d.endedAt ? { op: d.operatorName, started: !!d.chargeStartedAt } : null);
        // Paiement jamais confirmé depuis plus de 6 h : « Abandonner ce paiement ? »
        setStale(staleUnconfirmed(d) ? d.operatorName : null);
      });
      chargeState().then(setBadge);
    }, []),
  );

  useEffect(() => {
    loadOperators().then(setOps);
  }, []);

  /** « Oui » : archivé dans l'historique comme « non démarré », bandeau retiré. */
  async function abandonStale() {
    const d = store.direct();
    if (!d) return setStale(null);
    if (!(await abandonUnconfirmed(d))) return setStaleSaveErr(true);
    store.setDirect(null);
    setStaleSaveErr(false);
    setStale(null);
    setResume(null);
    chargeState().then(setBadge);
  }
  /** « Toujours en cours » : bandeau « Paiement en attente » gardé, question reposée dans 6 h. */
  function keepStale() {
    const d = store.direct();
    if (d) store.setDirect({ ...d, stillOnAt: Date.now() });
    setStale(null);
  }

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
    if (!selectedId || menu) return;
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
  }, [selectedId, menu]);


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
  // Liste : la borne conseillée (bandeau) n'y est pas répétée.
  const closest = useMemo(() => nearest(visible.filter((s) => s.id !== advisedId), ref, 5), [visible, ref.lat, ref.lon, advisedId]);
  // Disponibilité connue des bornes proches : pictogramme sur la carte (libre / occupé / hors service).
  const statusKey = useMemo(() => nearest(visible, ref, 40).map(({ s }) => s.id).join(','), [visible, ref.lat, ref.lon]);
  useEffect(() => {
    if (!statusKey) return;
    let alive = true;
    const list = statusKey.split(',').map((id) => byId.get(id)).filter((s): s is Station => !!s);
    getAvailability(list.flatMap((s) => (s.pdc ?? []).map(([id]) => id))).then((items) => {
      if (!alive) return;
      setAvailDown(availabilityDown());
      // Pas de réponse (chargement, échec) : aucune mention ; « inconnu » seulement si l'API renvoie ce statut.
      const next: Record<string, StationStatus> = {};
      for (const s of list) {
        const st = stationStatus(stationSummary(s, items));
        if (st) next[s.id] = st;
      }
      setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [statusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const nav = useTrip(map, geo.fix ?? user, Math.round(height * 0.55));
  const { trip, plan } = nav;
  // « Y aller » depuis une borne non payable (/?go=<station>) : itinéraire vers la borne payable la plus proche
  useGoParam({ byId, setById, ready: !!user || loc === 'denied', plan, setSelectedId });
  const rechargeHere = useRechargeHere();
  const [searching, setSearching] = useState(false);
  const PANEL = 440;
  // « Ma position » : position ET borne du bandeau (conseillée, « Vous êtes à ») ou, à défaut, la plus proche de la liste,
  // dans la partie visible de la carte (sous la recherche, au-dessus du panneau, à gauche des contrôles).
  const frameTarget = (advisedId ? byId.get(advisedId) : null) ?? closest[0]?.s ?? null;
  const controls = useMapControls(map, geo, {
    guiding: !!trip?.guiding,
    offsetY: wide ? 0 : -height * 0.18,
    frame: () => ({
      target: frameTarget,
      pad: wide
        ? { top: topH + 24, bottom: 48, left: 16 + PANEL + 40, right: 12 + 52 + 28 }
        : { top: topH + 24, bottom: (trip ? sheetH : Math.min(sheetH, Math.round(height * 0.46))) + 28, left: 32, right: 12 + 52 + 20 },
    }),
  });
  // Texte agrandi : fiche plus haute et action principale collée en bas du panneau (toujours atteignable).
  const sheetMax = Math.round(height * (trip ? 0.58 : selected ? (large ? 0.7 : 0.62) : 0.46));

  useEffect(() => {
    store.setStations(all);
  }, [all]);
  useEffect(() => {
    store.setCurrent(selected);
  }, [selected]);

  // Synchronisation carte
  useEffect(() => {
    if (!mapReady) return;
    // Bornes au même endroit (≤ 15 m, même parking) : une pastille « 3 bornes ici » qui se déploie en éventail au toucher.
    const gOf = new Map<string, string>();
    const groups = groupColocated(visible, 15)
      .filter((g) => g.length > 1)
      .map((g) => {
        const key = g.map((s) => s.id).sort()[0];
        for (const s of g) gOf.set(s.id, key);
        return { g: key, lat: g.reduce((a, s) => a + s.lat, 0) / g.length, lon: g.reduce((a, s) => a + s.lon, 0) / g.length, label: t.map.group(g.length) };
      });
    map.current?.post({
      type: 'stations',
      stations: visible.map((s) => {
        const st = status[s.id];
        const live = st === 'unknown' ? undefined : st;
        const label = s.kw ? kw(s.kw) : '';
        return { id: s.id, lat: s.lat, lon: s.lon, kw: s.kw, r: s.acc === 'reserve', label, st: live, g: gOf.get(s.id), a11y: [displayName(s), label, live ? availText(live) : null].filter(Boolean).join(', ') };
      }),
      groups,
    });
  }, [visible, mapReady, status, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attribution OSM / MapLibre toujours visible : sous la recherche et les filtres (mobile, loin du point bleu et de la fiche),
  // à droite du panneau (large), en bas pendant le guidage.
  useEffect(() => {
    if (!mapReady) return;
    map.current?.post(wide ? { type: 'pad', bottom: 0, left: 16 + PANEL + 8 } : trip?.guiding
          ? { type: 'pad', bottom: 0, left: 0 }
          : // Écran court ou texte agrandi : la position est sous la recherche, l'attribution reste juste au-dessus de la fiche.
            height - topH - sheetH > 220
            ? { type: 'pad', bottom: 0, left: 4, top: topH }
            : { type: 'pad', bottom: sheetH, left: 0 });
  }, [mapReady, wide, topH, sheetH, height, trip?.guiding]);

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
      if (trip) return;
      setSelectedId(m.id);
      // Borne touchée sur la carte : ramenée au-dessus de la fiche (zoom inchangé, l'éventail reste lisible).
      const s = byId.get(m.id);
      if (s) map.current?.post({ type: 'fly', lat: s.lat, lon: s.lon, offsetY: wide ? 0 : -height * 0.25 });
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

  // Squelette : chargement de la zone qui dure (> 300 ms) après un déplacement de la carte.
  const [skeleton, setSkeleton] = useState(false);
  useEffect(() => {
    if (!loading || (!panned && user)) return setSkeleton(false);
    const timer = setTimeout(() => setSkeleton(true), 300);
    return () => clearTimeout(timer);
  }, [loading, panned, !!user]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: keyof Filters) => setFilters((f) => ({ ...f, [k]: !f[k] }));
  const availText = (st: StationStatus) => (st === 'free' ? t.avail.libre : st === 'busy' ? t.avail.occupe : st === 'down' ? t.avail.hors_service : t.avail.inconnu);

  return (
    <View style={styles.root}>
      {/* Guidage en paysage : bandeau à gauche, carte (et flèche du véhicule) à droite. */}
      <View style={[StyleSheet.absoluteFill, trip?.guiding ? { left: guidanceSide(width, height) } : null]}>
        <MapView ref={map} onMessage={onMap} />
      </View>

      <View
        style={[styles.top, { paddingTop: insets.top + 10 }, trip?.guiding ? { display: 'none' } : null, { flexDirection: 'column', alignItems: 'stretch', zIndex: 5 }, wide && { right: undefined, width: PANEL + 32, paddingHorizontal: 16 }]}
        pointerEvents="box-none"
        onLayout={(e) => setTopH(Math.round(e.nativeEvent.layout.height))}
      >
        <View style={styles.searchRow}>
          {searching ? null : <MenuButton onPress={() => setMenu(true)} badge={badge} />}
          <View style={{ flex: 1, minWidth: 0 }}>
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
          </View>
        </View>
        <ScrollView horizontal style={[{ flexGrow: 0, paddingBottom: 8 }, searching || trip ? { display: 'none' } : null]} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t.map.filters}>
          <Chip label={t.map.fast} a11y={t.map.fastA11y} active={filters.fast} onPress={() => toggle('fast')} />
          <Chip label={t.plugs.ccs.split(' ')[0]} a11y={t.plugs.ccs} active={filters.ccs} onPress={() => toggle('ccs')} />
          <Chip label={t.plugs.t2} active={filters.t2} onPress={() => toggle('t2')} />
          <Chip label={t.map.open} active={filters.open} onPress={() => toggle('open')} />
        </ScrollView>
      </View>

      {!trip?.guiding && !searching ? (
        <MapControls
          api={controls}
          status={geo.status}
          height={height}
          top={topH + (wide ? 8 : 34)}
          left={wide ? 16 + PANEL + 12 : 12}
          bottom={wide ? 24 : sheetMax + 12}
          onLocate={() => {
            setPanned(false);
            setSelectedId(null);
          }}
        />
      ) : null}

      {trip?.guiding ? <Guidance nav={nav} onRecharge={rechargeHere} /> : null}
      <View
        style={[
          styles.sheet,
          wide ? [styles.sheetWide, { top: topH, width: PANEL, maxHeight: height - topH - 16 }] : { maxHeight: sheetMax },
          { paddingBottom: insets.bottom + 12 },
          trip?.guiding ? { display: 'none' } : null,
        ]}
        onLayout={(e) => setSheetH(Math.round(e.nativeEvent.layout.height))}
        testID="sheet"
      >
        {wide ? null : <View style={styles.grip} />}
        <ScrollView ref={sheetScroll} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
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
              onPick={select}
              stickyAction={large}
            />
          ) : (
            <>
              <View style={[styles.titleRow, large && { flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={[styles.h1, !large && { flex: 1 }]} accessibilityRole="header" numberOfLines={large ? 4 : 2}>
                  {panned || !user ? t.map.around : t.map.nearest}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t.map.scanA11y} testID="scan" onPress={() => router.push('/payer')} style={({ pressed }) => [styles.scanBtn, pressed && { backgroundColor: colors.border }]}>
                  <Icon name="qr" size={20} />
                  <Text style={styles.scanText}>{t.map.scan}</Text>
                </Pressable>
              </View>
              <ChargeShortcuts />
              {stale ? (
                <View style={styles.stale} role="alert" accessibilityLiveRegion="polite">
                  <Text style={styles.staleTitle} accessibilityRole="header">{t.map.staleQ}</Text>
                  <Text style={styles.staleBody}>{t.map.staleBody(stale)}</Text>
                  <Button label={t.map.staleYes} variant="secondary" onPress={abandonStale} />
                  <Button label={t.map.staleKeep} variant="ghost" onPress={keepStale} />
                  {staleSaveErr ? <SaveFailed /> : null}
                </View>
              ) : resume ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/recharge')} style={styles.resume}>
                  <Text style={styles.resumeText}>{t.map.resume(resume.op, resume.started)}</Text>
                </Pressable>
              ) : (
                <HereBanner user={user} onPick={select} filters={filters} onAdvised={setAdvisedId} />
              )}
              {loc === 'denied' && !panned && !selected ? (
                <Notice>{t.map.locDenied}</Notice>
              ) : null}
              {dataError ? (
                <View style={{ gap: 8 }} testID="data-error">
                  <Notice tone="error">{t.map.dataError}</Notice>
                  <Button
                    label={t.mapCtl.retry}
                    variant="secondary"
                    style={{ minHeight: 48 }}
                    loading={loading}
                    onPress={() => {
                      loadedFor.current = '';
                      void load(ref);
                    }}
                  />
                </View>
              ) : null}
              {availDown && !dataError && closest.length && !skeleton ? (
                <Text style={styles.small} testID="avail-down">{t.avail.offline}</Text>
              ) : null}
              {(loading && !closest.length) || skeleton ? (
                <View style={{ gap: 12 }} testID="list-skeleton">
                  <View style={styles.loading} accessibilityLiveRegion="polite">
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.muted}>{loc === 'pending' ? t.map.locating : t.map.loading}</Text>
                  </View>
                  {[0, 1, 2].map((k) => (
                    <View key={k} style={styles.skel} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <View style={[styles.skelBar, { width: '70%', height: 16 }]} />
                      <View style={[styles.skelBar, { width: '45%' }]} />
                    </View>
                  ))}
                </View>
              ) : null}
              {!loading && !dataError && !closest.length ? (
                <View style={styles.empty}>
                  <Text style={styles.muted}>{t.map.empty}</Text>
                  {filters.fast || filters.ccs || filters.t2 || filters.open ? (
                    <Pressable accessibilityRole="button" onPress={() => setFilters(NO_FILTERS)} style={styles.emptyBtn}>
                      <Text style={styles.emptyBtnText}>{t.map.clearFilters}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {(skeleton ? [] : closest).map(({ s }, i) => {
                // Distance seulement depuis la position réelle (jamais depuis le centre de la carte).
                const d = user ? distanceKm(user, s) : null;
                const st = status[s.id];
                const stLabel = st ? availText(st) : null;
                return (
                <Pressable
                  key={s.id}
                  onPress={() => select(s)}
                  accessibilityRole="button"
                  accessibilityLabel={[d != null ? t.map.itemA11y(displayName(s), km(d), kw(s.kw)) : [displayName(s), kw(s.kw)].join(', '), stLabel].filter(Boolean).join(', ')}
                  style={({ pressed }) => [styles.item, large && styles.itemLarge, i === 0 && !advisedId && styles.itemFirst, pressed && { backgroundColor: colors.surfaceAlt }]}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.itemTitle} numberOfLines={large ? 4 : 2}>
                      {displayName(s)}
                    </Text>
                    <Text style={styles.itemSub} numberOfLines={large ? 3 : 1}>
                      {[kw(s.kw), s.c.map((c) => plugLabel(c)).join(', '), s.acc === 'reserve' ? t.map.reserved : null].filter(Boolean).join(' · ')}
                    </Text>
                    {/* Statut temps réel par ligne ; rien tant que l'API n'a pas répondu ; « inconnu » renvoyé : mention discrète, sans pastille. */}
                    {st ? (
                      <View style={[styles.pill, st === 'free' ? styles.pillFree : st === 'busy' ? styles.pillBusy : st === 'down' ? styles.pillDown : styles.pillUnknown]} accessibilityElementsHidden importantForAccessibility="no">
                        <Text style={[styles.pillText, { color: st === 'free' ? colors.accentPressed : st === 'busy' ? colors.warnText : st === 'down' ? mapColors.statusDown : colors.inkMuted }, st === 'unknown' && styles.pillTextUnknown]}>{stLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                  {d != null ? (
                    <View style={{ alignItems: large ? 'flex-start' : 'flex-end' }}>
                      <Text style={styles.dist}>{km(d)}</Text>
                      <Text style={styles.itemSub}>{minutes(d)}</Text>
                    </View>
                  ) : null}
                </Pressable>
                );
              })}
              {Platform.OS === 'web' && !dataError && closest.length ? <Text style={styles.small}>{t.map.homeTip}</Text> : null}
            </>
          )}
        </ScrollView>
        {trip ? <TripFooter nav={nav} /> : selected && large ? <StationMainAction station={selected} distance={user ? distanceKm(user, selected) : null} /> : null}
      </View>
      <AppMenu open={menu} onClose={closeMenu} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.mapGround },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  chips: { gap: 8, paddingRight: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: MIN_TOUCH, paddingHorizontal: 14, borderRadius: 22, backgroundColor: colors.surfaceAlt },
  scanText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  empty: { gap: 8, paddingVertical: 8 },
  emptyBtn: { alignSelf: 'flex-start', minHeight: MIN_TOUCH, paddingHorizontal: 16, borderRadius: 22, borderWidth: 2, borderColor: colors.inputBorder, justifyContent: 'center' },
  emptyBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  round: {
    width: MIN_TOUCH + 4,
    height: MIN_TOUCH + 4,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.ink,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  roundText: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  recenter: { position: 'absolute', right: 16 },
  target: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: colors.position },
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
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  // Large (>= 768 px) : panneau latéral pleine hauteur sous la recherche, sans poignée.
  sheetWide: { right: undefined, left: 16, bottom: undefined, borderRadius: radius.xl, paddingTop: 16 },
  grip: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoBtn: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  resume: { minHeight: MIN_TOUCH, borderRadius: radius.md, backgroundColor: colors.ink, justifyContent: 'center', paddingHorizontal: 14 },
  resumeText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.onAccent },
  stale: { gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.busy, backgroundColor: colors.warnSoft, padding: 12 },
  staleTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  staleBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.warnText },
  h1: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  skel: { gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, minHeight: 64, justifyContent: 'center' },
  skelBar: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minHeight: 64 },
  itemFirst: { borderColor: colors.accent, borderWidth: 2 },
  itemLarge: { flexDirection: 'column', alignItems: 'stretch' },
  pill: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingVertical: 2, paddingHorizontal: 8, marginTop: 2 },
  pillFree: { backgroundColor: colors.accentSoft },
  pillBusy: { backgroundColor: colors.warnSoft },
  pillDown: { backgroundColor: colors.surfaceAlt },
  pillUnknown: { paddingHorizontal: 0, paddingVertical: 0 },
  pillText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  pillTextUnknown: { fontFamily: fonts.medium },
  itemTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  itemSub: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkMuted },
  dist: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
