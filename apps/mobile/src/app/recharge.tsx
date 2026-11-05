import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice } from '../components/ui';
import { store, type DirectCharge } from '../lib/store';
import { colors, fonts } from '../theme';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
};

/** Suivi d'une recharge payée directement chez l'opérateur (connecteurs scan / lien opérateur). */
export default function Recharge() {
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<DirectCharge | null | undefined>(store.direct() ?? undefined);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (d === undefined) store.loadDirect().then(setD);
  }, [d]);

  const charging = !!d?.chargeStartedAt && !d.endedAt;
  useEffect(() => {
    if (!charging) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [charging]);

  const update = (patch: Partial<DirectCharge> | null) => {
    const next = patch && d ? { ...d, ...patch } : null;
    store.setDirect(next);
    setD(next);
    setNow(Date.now());
  };

  if (d === undefined) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.charge} />
      </View>
    );
  }
  if (!d) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.title}>Aucune recharge en cours</Text>
        <Button label="Retour à la carte" variant="light" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  const reopen = () => (Platform.OS === 'web' ? window.open(d.url, '_blank', 'noopener,noreferrer') : WebBrowser.openBrowserAsync(d.url));
  const elapsed = d.chargeStartedAt ? (d.endedAt ?? now) - d.chargeStartedAt : 0;
  const home = () => {
    update(null);
    router.replace('/');
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.station} numberOfLines={2}>
        {d.station.name}
      </Text>

      {!d.chargeStartedAt ? (
        <>
          <View style={styles.ring}>
            <Text style={styles.stateBig}>Paiement en cours chez {d.operatorName}</Text>
            <Text style={styles.muted}>Finalisez le paiement sur la page de l’opérateur. La borne démarre une fois le paiement validé.</Text>
          </View>
          <Button label={`Rouvrir la page ${d.operatorName}`} variant="light" onPress={reopen} />
          <Button label="J’ai payé et la charge a démarré" onPress={() => update({ chargeStartedAt: Date.now() })} />
          <Button label="Annuler" variant="ghost" onPress={home} />
        </>
      ) : !d.endedAt ? (
        <>
          <View style={styles.ring}>
            <Text style={styles.big}>{fmt(elapsed)}</Text>
            <Text style={styles.state}>Recharge en cours · payée chez {d.operatorName}</Text>
            <Text style={styles.muted}>Le montant et le reçu viennent de {d.operatorName} (e-mail ou page de paiement).</Text>
          </View>
          <Notice>Pensez à libérer la place en fin de charge : certains opérateurs facturent l’occupation.</Notice>
          <Button label="J’ai terminé ma recharge" onPress={() => update({ endedAt: Date.now() })} />
          <Button label={`Rouvrir la page ${d.operatorName}`} variant="ghost" onPress={reopen} />
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Récapitulatif</Text>
            <Text style={styles.muted}>Borne : {d.station.name}</Text>
            <Text style={styles.muted}>Payé directement à : {d.operatorName}</Text>
            <Text style={styles.muted}>Durée : {fmt(elapsed)}</Text>
          </View>
          <Button label="Retour à la carte" onPress={home} />
        </>
      )}
      {d.station.tel ? <Button label={`Appeler ${d.operatorName}`} variant="ghost" onPress={() => Linking.openURL(`tel:${d.station.tel!.replace(/[^+\d]/g, '')}`)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.nightBg },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  body: { paddingHorizontal: 20, gap: 16, maxWidth: 600, width: '100%', alignSelf: 'center' },
  title: { fontFamily: fonts.display, fontSize: 22, color: '#F2F6F4' },
  station: { fontFamily: fonts.semibold, fontSize: 15, color: colors.nightMuted },
  ring: { alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 16, borderRadius: 24, backgroundColor: colors.nightCard },
  big: { fontFamily: fonts.display, fontSize: 44, color: '#F2F6F4' },
  stateBig: { fontFamily: fonts.display, fontSize: 22, color: '#F2F6F4', textAlign: 'center' },
  state: { fontFamily: fonts.bold, fontSize: 16, color: colors.charge, textAlign: 'center' },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.nightMuted, lineHeight: 20, textAlign: 'center' },
  card: { backgroundColor: colors.nightCard, borderRadius: 16, padding: 16, gap: 6 },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: '#F2F6F4' },
});
