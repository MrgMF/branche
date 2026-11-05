import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice, Stat } from '../components/ui';
import { cancelSession, getSession, stopSession, type Session } from '../lib/api';
import { openCheckout } from '../lib/charge';
import { euros, kw, kwh } from '../lib/format';
import { colors, fonts } from '../theme';

const ACTIVE = new Set(['awaiting_payment', 'starting', 'charging']);

export default function SessionScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ session?: string; id?: string; cancelled?: string }>();
  const id = params.session ?? params.id ?? '';
  const [s, setS] = useState<Session | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const tick = () =>
      getSession(id)
        .then((x) => {
          if (!alive) return;
          setS(x);
          setErr(null);
          if (!ACTIVE.has(x.status) && timer.current) clearInterval(timer.current);
        })
        .catch((e) => alive && setErr(e instanceof Error ? e.message : 'Connexion perdue.'));
    tick();
    timer.current = setInterval(tick, 2000);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [id]);

  async function act(fn: (id: string) => Promise<Session>) {
    setBusy(true);
    try {
      setS(await fn(id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  const home = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!id) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.title}>Aucune recharge en cours</Text>
        <Button label="Retour à la carte" variant="light" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch', marginTop: 24 }} />
      </View>
    );
  }

  const pct = s ? Math.min(1, s.totalCents / Math.max(1, s.preauthCents)) : 0;
  const statusText: Record<Session['status'], string> = {
    awaiting_payment: 'En attente de l’autorisation de paiement',
    starting: 'Démarrage de la borne…',
    charging: s?.powerKw ? `En charge · ${kw(s.powerKw)}` : 'En charge',
    completed: 'Recharge terminée',
    cancelled: 'Recharge annulée — aucun montant débité',
    failed: 'La borne n’a pas démarré — aucun montant débité',
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.headRow}>
        <Button label="Carte" variant="ghost" onPress={home} style={styles.back} />
        <Text style={styles.station} numberOfLines={2}>
          {s?.stationName ?? 'Recharge'}
        </Text>
      </View>

      {s?.demo ? <Notice tone="demo">Mode démo : borne et paiement simulés, aucun débit réel.</Notice> : null}

      {!s && !err ? <ActivityIndicator color={colors.charge} style={{ marginTop: 60 }} /> : null}
      {err ? <Notice tone="error">{err}</Notice> : null}

      {s ? (
        <>
          <View style={styles.ring} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
            <Text style={styles.big}>{s.status === 'completed' ? euros(s.totalCents) : kwh(s.energyWh)}</Text>
            <Text style={styles.state}>{statusText[s.status]}</Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <Text style={styles.muted}>
              {euros(s.totalCents)} sur {euros(s.preauthCents)} pré-autorisés
            </Text>
          </View>

          <View style={styles.stats}>
            {s.status === 'completed' ? (
              <Stat dark label="Durée" value={duration(s.startedAt, s.endedAt)} />
            ) : (
              <Stat dark label="Puissance" value={s.powerKw ? kw(s.powerKw) : '—'} />
            )}
            <Stat dark label="Coût énergie" value={euros(s.costCents)} />
            <Stat dark label="Frais Branché" value={euros(s.feeCents)} />
          </View>

          {s.status === 'awaiting_payment' ? (
            <View style={{ gap: 10 }}>
              <Button label="Reprendre le paiement" onPress={() => openCheckout(s)} />
              <Button label="Annuler" variant="light" loading={busy} onPress={() => act(cancelSession)} />
            </View>
          ) : null}
          {s.status === 'charging' || s.status === 'starting' ? (
            <Button label="Arrêter la charge" variant="light" loading={busy} onPress={() => act(stopSession)} hint="Arrête la charge et débite le montant réel" />
          ) : null}
          {s.status === 'completed' ? (
            <View style={styles.receipt} accessibilityLabel="Reçu">
              <Text style={styles.receiptTitle}>Reçu</Text>
              <Row k="Énergie" v={kwh(s.energyWh)} />
              <Row k={`Énergie à ${euros(s.priceCentsPerKwh)}/kWh`} v={euros(s.costCents)} />
              <Row k="Frais de service" v={euros(s.feeCents)} />
              <Row k={s.demo ? 'Total (simulé)' : 'Total débité'} v={euros(s.totalCents)} strong />
              <Text style={styles.muted}>Référence {s.id}</Text>
            </View>
          ) : null}
          {!ACTIVE.has(s.status) ? <Button label="Retour à la carte" onPress={() => router.replace('/')} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function duration(a: string | null, b: string | null) {
  if (!a || !b) return '—';
  const min = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowK, strong && styles.strong]}>{k}</Text>
      <Text style={[styles.rowV, strong && styles.strong]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.nightBg },
  center: { alignItems: 'center', paddingHorizontal: 24 },
  body: { paddingHorizontal: 20, gap: 18 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: 44, paddingHorizontal: 14 },
  station: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.nightMuted },
  title: { fontFamily: fonts.display, fontSize: 22, color: '#F2F6F4' },
  ring: { alignItems: 'center', gap: 8, paddingVertical: 28, borderRadius: 24, backgroundColor: colors.nightCard },
  big: { fontFamily: fonts.display, fontSize: 52, color: '#F2F6F4' },
  state: { fontFamily: fonts.bold, fontSize: 16, color: colors.charge, textAlign: 'center', paddingHorizontal: 16 },
  bar: { width: '80%', height: 8, borderRadius: 4, backgroundColor: '#24342F', overflow: 'hidden', marginTop: 6 },
  barFill: { height: 8, backgroundColor: colors.charge },
  muted: { fontFamily: fonts.medium, fontSize: 13, color: colors.nightMuted },
  stats: { flexDirection: 'row', gap: 10 },
  receipt: { backgroundColor: colors.nightCard, borderRadius: 16, padding: 16, gap: 8 },
  receiptTitle: { fontFamily: fonts.display, fontSize: 18, color: '#F2F6F4' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowK: { fontFamily: fonts.medium, fontSize: 15, color: colors.nightMuted, flex: 1 },
  rowV: { fontFamily: fonts.semibold, fontSize: 15, color: '#F2F6F4' },
  strong: { color: '#F2F6F4', fontFamily: fonts.bold, fontSize: 17 },
});
