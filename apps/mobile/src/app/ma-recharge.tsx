// « Ma recharge » (menu) : recharge préparée, sinon état vide avec les deux façons de démarrer.
// Une recharge suivie en cours ouvre directement /recharge depuis le menu.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoCharge } from '../components/NoCharge';
import { ScreenHeader } from '../components/Screen';
import { Button } from '../components/ui';
import { useT } from '../i18n';
import { euros } from '../lib/format';
import { methodLabel } from '../lib/history';
import { clearPrepared, loadPrepared, type Prepared } from '../lib/prepared';
import { displayName } from '../lib/stations';
import { store, type DirectCharge } from '../lib/store';
import { colors, fonts, radius } from '../theme';

export default function MaRecharge() {
  const t = useT();
  const M = t.maRecharge;
  const insets = useSafeAreaInsets();
  const [prep, setPrep] = useState<Prepared | null | undefined>(undefined);
  const [direct, setDirect] = useState<DirectCharge | null>(null);

  useFocusEffect(
    useCallback(() => {
      store.loadDirect().then(setDirect);
      loadPrepared().then(setPrep);
    }, []),
  );

  const active = direct && (!direct.endedAt || direct.autoEnded) ? direct : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
      <ScreenHeader title={t.titles.maRecharge} />
      {prep === undefined ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : null}

      {active ? (
        <View style={[styles.card, styles.on]} accessibilityRole="summary">
          {/* Fin automatique (départ ou > 24 h) : le reçu attend le prix réellement payé */}
          <Text style={styles.kicker}>{active.endedAt && active.autoEnded ? M.endedKicker : M.activeKicker}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {active.station.name}
          </Text>
          <Text style={styles.p}>{M.activeBody(active.operatorName)}</Text>
          <Button label={M.open} onPress={() => router.push('/recharge')} />
        </View>
      ) : null}

      {prep ? (
        <View style={[styles.card, !active && styles.on]} accessibilityRole="summary">
          <Text style={styles.kicker}>{M.preparedKicker}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {displayName(prep.station)}
          </Text>
          <Text style={styles.p}>{M.preparedBody(methodLabel(prep.plan.method), prep.estimatedCost != null ? euros(Math.round(prep.estimatedCost * 100)) : null)}</Text>
          <Button
            label={M.openPrepared}
            variant={active ? 'secondary' : 'primary'}
            onPress={() => {
              store.setCurrent(prep.station);
              router.push({ pathname: '/recharger', params: { station: prep.station.id } });
            }}
          />
          <Button
            label={M.cancelPrepared}
            variant="ghost"
            onPress={async () => {
              await clearPrepared();
              setPrep(null);
            }}
          />
        </View>
      ) : null}

      {prep === null && !active ? <NoCharge /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 16, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 16, gap: 10 },
  on: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentPressed, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, textAlign: 'left' },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkMuted },
});
