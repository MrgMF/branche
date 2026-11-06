// « Vous êtes à X » : détection à moins de 60 m d'une station, à l'ouverture ET au retour au premier plan
// (ex. arrivée guidée par Waze ou Google Maps, puis ouverture de Branché). Un seul bouton : « Recharger ici ».
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { getAvailability, stationSummary } from '../lib/availability';
import { runPlan } from '../lib/connectors';
import { shortId } from '../lib/evse';
import { euros, km, kw, plugLabel } from '../lib/format';
import { methodLabel } from '../lib/history';
import { clearPrepared, loadPrepared, type Prepared } from '../lib/prepared';
import { compatible, loadVehicle, type Vehicle } from '../lib/vehicle';
import { nearbyStation } from '../lib/proximity';
import { applyFilters, displayName, distanceKm, loadAround, nearest, NO_FILTERS, type Filters, type Station } from '../lib/stations';
import { autoFinish, departed } from '../lib/autoEnd';
import { allDown, nearestFree } from '../lib/nearestFree';
import { store, type DirectCharge } from '../lib/store';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { Button, Notice } from './ui';
import { useT } from '../i18n';
import { distText } from '../i18n/format';

type Pos = { lat: number; lon: number };

/**
 * `filters` : la borne conseillée respecte les filtres de la carte. `onAdvised` : identifiant de la borne conseillée affichée
 * (la carte l'omet de sa liste pour ne pas la répéter). Sans position, aucune borne n'est conseillée (pas de distance inventée).
 */
export function HereBanner({ user, onPick, filters = NO_FILTERS, onAdvised }: { user: Pos | null; onPick?: (s: Station) => void; filters?: Filters; onAdvised?: (id: string | null) => void }) {
  const t = useT();
  const [pos, setPos] = useState<Pos | null>(user);
  const [hit, setHit] = useState<{ station: Station; distanceM: number } | null>(null);
  const [around, setAround] = useState<Station[]>([]);
  const [hidden, setHidden] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [offline, setOffline] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [pick, setPick] = useState<{ s: Station; d: number; free: number; known: number; down: boolean } | null>(null);
  // Borne où l'on se trouve entièrement hors service : borne libre la plus proche (undefined = recherche en cours).
  const [hitDown, setHitDown] = useState<{ id: string; alt: { s: Station; d: number } | null | undefined } | null>(null);

  useEffect(() => {
    if (user) setPos(user);
  }, [user?.lat, user?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadPrepared().then(setPrepared);
    loadVehicle().then(setVehicle);
  }, []);

  // Retour au premier plan : nouvelle position (l'utilisateur vient peut-être d'arriver à la borne)
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
      loadPrepared().then(setPrepared);
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
      } catch {
        /* position indisponible : on garde la précédente */
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!pos) return;
    let alive = true;
    const local = nearbyStation(store.stations(), pos);
    if (local) setHit(local);
    loadAround(pos, 1)
      .then((list) => {
        if (!alive) return;
        setHit(nearbyStation(list, pos));
        setAround(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pos?.lat, pos?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sans geste : borne compatible la plus proche (libre en priorité si l'info existe)
  useEffect(() => {
    if (!pos || !around.length) return setPick(null);
    let alive = true;
    const cands = nearest(applyFilters(around, filters).filter((s) => s.acc !== 'reserve' && compatible(s.c, vehicle)), pos, 6);
    if (!cands.length) return setPick(null);
    getAvailability(cands.flatMap(({ s }) => (s.pdc ?? []).map(([id]) => id))).then((items) => {
      if (!alive) return;
      const scored = cands.map(({ s, d }) => {
        const sum = stationSummary(s, items);
        return { s, d, ...sum, down: allDown(sum) };
      });
      // Jamais une borne entièrement hors service quand une autre est possible.
      const first = scored.find((x) => !x.down) ?? scored[0];
      const freeOne = scored.find((x) => x.free > 0 && x.d <= first.d * 1.5 + 0.3);
      const best = first.known && !first.free && freeOne ? freeOne : first;
      setPick({ s: best.s, d: best.d, free: best.free, known: best.known, down: best.down });
    });
    return () => {
      alive = false;
    };
  }, [around, vehicle, pos?.lat, pos?.lon, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const hitId = hit?.station.id ?? null;
  useEffect(() => {
    setHitDown(null);
    if (!hit) return;
    let alive = true;
    const s = hit.station;
    getAvailability((s.pdc ?? []).map(([id]) => id)).then((items) => {
      if (!alive || !allDown(stationSummary(s, items))) return;
      setHitDown({ id: s.id, alt: undefined });
      nearestFree(s, around.length ? around : store.stations(), s.id).then((alt) => alive && setHitDown({ id: s.id, alt }));
    });
    return () => {
      alive = false;
    };
  }, [hitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Borne conseillée réellement affichée (cas 3 ci-dessous), signalée à la carte.
  const preparedHere = !!(hit && prepared && prepared.station.id === hit.station.id);
  const hereShown = !!(hit && hidden !== hit.station.id);
  const advisedId = !preparedHere && !hereShown && onPick ? (prepared ? prepared.station.id : pick?.s.id ?? null) : null;
  useEffect(() => {
    onAdvised?.(advisedId);
  }, [advisedId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onAdvised?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 1. Arrivé à une borne préparée : un seul geste pour payer
  if (hit && prepared && prepared.station.id === hit.station.id) {
    const p = prepared;
    const cost = p.estimatedCost != null ? ` · ≈ ${euros(Math.round(p.estimatedCost * 100))}` : '';
    return (
      <View style={styles.card} accessibilityRole="summary">
        <Text style={styles.kicker}>{t.here.ready}</Text>
        <Text style={styles.title} numberOfLines={4}>
          {displayName(hit.station)}
        </Text>
        <Text style={styles.sub}>
          {p.plan.pdcId ? `${t.common.point(shortId(p.plan.pdcId))} · ` : ''}
          {methodLabel(p.plan.method)}
          {cost}
        </Text>
        <Button
          label={t.here.payNow}
          onPress={() => {
            setOffline(false);
            // Sans réseau : la recharge préparée est gardée (rien n'est ouvert), message affiché
            runPlan(hit.station, p.plan, p.operatorName, p.url).then((r) => {
              if (r === 'offline') return setOffline(true);
              clearPrepared();
              setPrepared(null);
            });
          }}
          hint={t.here.payHint(p.operatorName)}
        />
        {offline ? (
          <View role="alert" accessibilityLiveRegion="assertive">
            <Notice tone="error">{t.common.noNetwork}</Notice>
          </View>
        ) : null}
        <Text style={styles.small}>{t.here.payNote(p.operatorName)}</Text>
      </View>
    );
  }

  // 2. À moins de 60 m d'une station : « Recharger ici »
  if (hit && hidden !== hit.station.id) {
    const s = hit.station;
    const down = hitDown?.id === s.id;
    const downAlt = down ? hitDown.alt : undefined;
    return (
      <View style={[styles.card, down && styles.cardDown]} accessibilityRole="summary" accessibilityLabel={t.here.youAreAtA11y(displayName(s), distText(hit.distanceM))}>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.kicker}>{t.here.youAreAt}</Text>
            <Text style={styles.title} numberOfLines={4}>
              {displayName(s)}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {distText(hit.distanceM)} · {kw(s.kw)} · {s.c.map((c) => plugLabel(c)).join(', ')}
            </Text>
            {down ? <Text style={styles.down}>{t.station.allDown}</Text> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t.here.hide} onPress={() => setHidden(s.id)} style={styles.close}>
            <Text style={styles.closeX}>×</Text>
          </Pressable>
        </View>
        {down && downAlt && onPick ? <Button label={t.station.nearestFree} hint={t.station.nearestFreeHint} onPress={() => onPick(downAlt.s)} /> : null}
        {down && downAlt === null ? <Text style={styles.small}>{t.station.noFreeNearby}</Text> : null}
        <Button
          label={t.here.rechargeHere}
          variant={down ? 'secondary' : 'primary'}
          onPress={() => {
            store.setCurrent(s);
            router.push({ pathname: '/recharger', params: { station: s.id } });
          }}
          hint={t.here.rechargeHint}
        />
      </View>
    );
  }

  // 3. Recharge préparée ailleurs, ou borne conseillée (aucun geste requis pour la voir)
  const target = prepared ? { s: prepared.station, d: pos ? distanceKm(pos, prepared.station) : null, free: 0, known: 0, down: false } : pick;
  if (!target || !onPick) return null;
  return (
    <View style={[styles.card, styles.soft]} accessibilityRole="summary">
      <Text style={styles.kicker}>{prepared ? t.here.prepared : vehicle ? t.here.advisedFor(vehicle.name) : t.here.advised}</Text>
      <Text style={styles.title} numberOfLines={4}>
        {displayName(target.s)}
      </Text>
      <Text style={styles.sub} numberOfLines={2}>
        {[target.d != null ? km(target.d) : null, kw(target.s.kw), target.known ? (target.free ? t.here.freeNow(target.free) : target.down ? t.here.down : t.here.busy) : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Button label={t.here.see} onPress={() => onPick(target.s)} hint={t.here.seeHint} />
    </View>
  );
}

const styles = StyleSheet.create({
  soft: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  cardDown: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  down: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.danger, marginTop: 2 },
  card: { backgroundColor: colors.accentSoft, borderRadius: radius.lg, padding: 14, gap: 10, borderWidth: 2, borderColor: colors.accent },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentPressed, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkMuted },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  closeX: { fontSize: 24, lineHeight: 26, color: colors.ink, fontFamily: fonts.medium },
});

/**
 * Fin automatique constatée à l'ouverture (les autres sections sont dans le menu) : si une recharge suivie est en cours et que l'on est loin de la borne, elle est terminée et
 * déjà dans l'historique ; il ne reste qu'à noter le prix (facultatif).
 */
export function ChargeShortcuts() {
  const t = useT();
  const [ended, setEnded] = useState<DirectCharge | null>(null);

  useEffect(() => {
    const check = async () => {
      const d = await store.loadDirect();
      if (d?.endedAt) return setEnded(d.autoEnded ? d : null);
      if (!d?.chargeStartedAt) return setEnded(null);
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (departed(d, { lat: p.coords.latitude, lon: p.coords.longitude, speed: p.coords.speed ?? null, at: Date.now() }, true)) {
          const next = await autoFinish(d);
          store.setDirect(next);
          setEnded(next);
        }
      } catch {
        /* position indisponible */
      }
    };
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => sub.remove();
  }, []);

  return (
    <>
      {ended ? (
        <View style={styles.card} accessibilityRole="summary">
          <Text style={styles.kicker}>{t.here.ended}</Text>
          <Text style={styles.title} numberOfLines={4}>
            {ended.station.name}
          </Text>
          <Text style={styles.sub}>{t.here.endedBody}</Text>
          <Button label={t.here.notePrice} onPress={() => router.push('/recharge')} />
        </View>
      ) : null}
    </>
  );
}
