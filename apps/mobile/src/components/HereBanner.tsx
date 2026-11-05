// « Vous êtes à X » : détection à moins de 60 m d'une station, à l'ouverture ET au retour au premier plan
// (ex. arrivée guidée par Waze ou Google Maps, puis ouverture de Branché). Un seul bouton : « Recharger ici ».
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { kw, PLUG_LABEL } from '../lib/format';
import { nearbyStation } from '../lib/proximity';
import { displayName, loadAround, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { Button } from './ui';

type Pos = { lat: number; lon: number };

export function HereBanner({ user }: { user: Pos | null }) {
  const [pos, setPos] = useState<Pos | null>(user);
  const [hit, setHit] = useState<{ station: Station; distanceM: number } | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    if (user) setPos(user);
  }, [user?.lat, user?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retour au premier plan : nouvelle position (l'utilisateur vient peut-être d'arriver à la borne)
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
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
      .then((list) => alive && setHit(nearbyStation(list, pos)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pos?.lat, pos?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hit || hidden === hit.station.id) return null;
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

const styles = StyleSheet.create({
  card: { backgroundColor: colors.accentSoft, borderRadius: radius.lg, padding: 14, gap: 10, borderWidth: 2, borderColor: colors.accent },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentPressed, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkMuted },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  closeX: { fontSize: 24, lineHeight: 26, color: colors.ink, fontFamily: fonts.medium },
});

/** Accès en un geste depuis la carte aux écrans du parcours de recharge (routes : /historique, /vehicule, /recharger). */
export function ChargeShortcuts() {
  return (
    <View style={short.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Mes recharges" accessibilityHint="Historique, dépenses du mois, export CSV" onPress={() => router.push('/historique')} style={short.btn}>
        <Text style={short.text}>Mes recharges</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Mon véhicule" accessibilityHint="Modèle et batterie, pour estimer durée et prix" onPress={() => router.push('/vehicule')} style={short.btn}>
        <Text style={short.text}>Mon véhicule</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Scanner une borne" accessibilityHint="Lire le QR code de la borne pour la recharger" onPress={() => router.push('/payer')} style={short.btn}>
        <Text style={short.text}>Scanner</Text>
      </Pressable>
    </View>
  );
}

const short = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  text: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, textAlign: 'center' },
});
