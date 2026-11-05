// « Vous êtes à X » : détection à moins de 60 m d'une station, à l'ouverture ET au retour au premier plan
// (ex. arrivée guidée par Waze ou Google Maps, puis ouverture de Branché). Un seul bouton : « Recharger ici ».
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { getAvailability, stationSummary } from '../lib/availability';
import { runPlan } from '../lib/connectors';
import { shortId } from '../lib/evse';
import { euros, km, kw, PLUG_LABEL } from '../lib/format';
import { METHOD_LABEL } from '../lib/history';
import { clearPrepared, loadPrepared, type Prepared } from '../lib/prepared';
import { compatible, loadVehicle, type Vehicle } from '../lib/vehicle';
import { nearbyStation } from '../lib/proximity';
import { displayName, distanceKm, loadAround, nearest, type Station } from '../lib/stations';
import { autoFinish, departed } from '../lib/autoEnd';
import { store, type DirectCharge } from '../lib/store';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { Button } from './ui';

type Pos = { lat: number; lon: number };

export function HereBanner({ user, onPick }: { user: Pos | null; onPick?: (s: Station) => void }) {
  const [pos, setPos] = useState<Pos | null>(user);
  const [hit, setHit] = useState<{ station: Station; distanceM: number } | null>(null);
  const [around, setAround] = useState<Station[]>([]);
  const [hidden, setHidden] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [pick, setPick] = useState<{ s: Station; d: number; free: number; known: number } | null>(null);

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
    if (!pos || !around.length) return;
    let alive = true;
    const cands = nearest(around.filter((s) => s.acc !== 'reserve' && compatible(s.c, vehicle)), pos, 6);
    if (!cands.length) return;
    getAvailability(cands.flatMap(({ s }) => (s.pdc ?? []).map(([id]) => id))).then((items) => {
      if (!alive) return;
      const scored = cands.map(({ s, d }) => ({ s, d, ...stationSummary(s, items) }));
      const first = scored[0];
      const freeOne = scored.find((x) => x.free > 0 && x.d <= first.d * 1.5 + 0.3);
      const best = first.known && !first.free && freeOne ? freeOne : first;
      setPick({ s: best.s, d: best.d, free: best.free, known: best.known });
    });
    return () => {
      alive = false;
    };
  }, [around, vehicle, pos?.lat, pos?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1. Arrivé à une borne préparée : un seul geste pour payer
  if (hit && prepared && prepared.station.id === hit.station.id) {
    const p = prepared;
    const cost = p.estimatedCost != null ? ` · ≈ ${euros(Math.round(p.estimatedCost * 100))}` : '';
    return (
      <View style={styles.card} accessibilityRole="summary">
        <Text style={styles.kicker}>Tout est prêt</Text>
        <Text style={styles.title} numberOfLines={2}>
          {displayName(hit.station)}
        </Text>
        <Text style={styles.sub}>
          {p.plan.pdcId ? `Point …${shortId(p.plan.pdcId)} · ` : ''}
          {METHOD_LABEL[p.plan.method]}
          {cost}
        </Text>
        <Button
          label="Payer maintenant"
          onPress={() => {
            clearPrepared();
            setPrepared(null);
            runPlan(hit.station, p.plan, p.operatorName, p.url);
          }}
          hint={`Paiement à la borne, directement à ${p.operatorName}`}
        />
        <Text style={styles.small}>Vous payez directement {p.operatorName} : rien n’a été débité à l’avance.</Text>
      </View>
    );
  }

  // 2. À moins de 60 m d'une station : « Recharger ici »
  if (hit && hidden !== hit.station.id) {
    const s = hit.station;
    return (
      <View style={styles.card} accessibilityRole="summary" accessibilityLabel={`Vous êtes à ${displayName(s)}, à ${hit.distanceM} mètres`}>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.kicker}>Vous êtes à</Text>
            <Text style={styles.title} numberOfLines={2}>
              {displayName(s)}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {hit.distanceM} m · {kw(s.kw)} · {s.c.map((c) => PLUG_LABEL[c]).join(', ')}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Masquer" onPress={() => setHidden(s.id)} style={styles.close}>
            <Text style={styles.closeX}>×</Text>
          </Pressable>
        </View>
        <Button
          label="Recharger ici"
          onPress={() => {
            store.setCurrent(s);
            router.push({ pathname: '/recharger', params: { station: s.id } });
          }}
          hint="Choix du point, prix et mode d’emploi de cette borne"
        />
      </View>
    );
  }

  // 3. Recharge préparée ailleurs, ou borne conseillée (aucun geste requis pour la voir)
  const target = prepared ? { s: prepared.station, d: pos ? distanceKm(pos, prepared.station) : null, free: 0, known: 0 } : pick;
  if (!target || !onPick) return null;
  return (
    <View style={[styles.card, styles.soft]} accessibilityRole="summary">
      <Text style={styles.kicker}>{prepared ? 'Recharge préparée' : vehicle ? `Conseillée pour ${vehicle.name}` : 'Borne conseillée'}</Text>
      <Text style={styles.title} numberOfLines={2}>
        {displayName(target.s)}
      </Text>
      <Text style={styles.sub} numberOfLines={2}>
        {[target.d != null ? km(target.d) : null, kw(target.s.kw), target.known ? (target.free ? `${target.free} libre${target.free > 1 ? 's' : ''} maintenant` : 'occupée') : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Button label="Voir la borne" variant="secondary" onPress={() => onPick(target.s)} hint="Fiche de la borne : itinéraire et recharge" />
    </View>
  );
}

const styles = StyleSheet.create({
  soft: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  card: { backgroundColor: colors.accentSoft, borderRadius: radius.lg, padding: 14, gap: 10, borderWidth: 2, borderColor: colors.accent },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentPressed, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkMuted },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  closeX: { fontSize: 24, lineHeight: 26, color: colors.ink, fontFamily: fonts.medium },
});

/**
 * Accès en un geste depuis la carte (routes /historique, /vehicule, /comptes, /payer) et fin automatique constatée
 * à l'ouverture : si une recharge suivie est en cours et que l'on est loin de la borne, elle est terminée et
 * déjà dans l'historique ; il ne reste qu'à noter le prix (facultatif).
 */
export function ChargeShortcuts() {
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
          <Text style={styles.kicker}>Recharge terminée</Text>
          <Text style={styles.title} numberOfLines={2}>
            {ended.station.name}
          </Text>
          <Text style={styles.sub}>Départ détecté : le reçu est déjà dans votre historique.</Text>
          <Button label="Noter le prix (2 secondes)" onPress={() => router.push('/recharge')} />
        </View>
      ) : null}
      <View style={short.row}>
        {[
          { label: 'Recharges', a11y: 'Mes recharges : historique, dépenses, export', to: '/historique' },
          { label: 'Véhicule', a11y: 'Mon véhicule et ma batterie', to: '/vehicule' },
          { label: 'Badges', a11y: 'Mes badges et comptes de recharge', to: '/comptes' },
          { label: 'Scanner', a11y: 'Scanner le QR code d’une borne', to: '/payer' },
        ].map((b) => (
          <Pressable key={b.to} accessibilityRole="button" accessibilityLabel={b.a11y} onPress={() => router.push(b.to as never)} style={short.btn}>
            <Text style={short.text} numberOfLines={1}>
              {b.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const short = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  btn: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  text: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, textAlign: 'center' },
});
