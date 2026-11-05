// Historique & dépenses : liste, total du mois, prix moyen au kWh, export CSV (note de frais), suppression.
// Tout est stocké sur l'appareil ; rien n'est envoyé.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice, Stat } from '../components/ui';
import { durationLabel } from '../lib/estimate';
import { euros } from '../lib/format';
import { clearHistory, loadHistory, METHOD_LABEL, monthStats, removeRecord, toCsv, totals, type ChargeRecord } from '../lib/history';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

const dateFr = (t: number) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const hour = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const perKwh = (x: number | null) => (x == null ? '—' : `${x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

export default function Historique() {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<ChargeRecord[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    loadHistory().then(setList);
  }, []);

  async function exportCsv() {
    if (!list?.length) return;
    const csv = toCsv(list);
    const name = `branche-recharges-${new Date().toISOString().slice(0, 10)}.csv`;
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(`Fichier ${name} téléchargé.`);
    } else {
      // Feuille de partage du système (e-mail, Fichiers, messagerie…) : le CSV en texte.
      await Share.share({ title: name, message: csv }).catch(() => undefined);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const m = list ? monthStats(list) : null;
  const all = list ? totals(list) : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.head}>
        <Button label="Retour" variant="ghost" onPress={back} style={styles.back} />
        <Text style={styles.h1} accessibilityRole="header">Mes recharges</Text>
      </View>

      {m ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.h2}>Ce mois-ci · {m.month}</Text>
          <View style={styles.stats}>
            <Stat label="Dépensé" value={euros(Math.round(m.total * 100))} />
            <Stat label="Recharges" value={String(m.count)} />
            <Stat label="Prix moyen / kWh" value={perKwh(m.avgPerKwh)} />
          </View>
          {m.count > m.paidCount ? <Text style={styles.small}>{m.count - m.paidCount} recharge(s) sans montant renseigné, non comptée(s) dans le total.</Text> : null}
          {all && all.count > m.count ? <Text style={styles.small}>Depuis le début : {euros(Math.round(all.total * 100))} pour {all.count} recharges.</Text> : null}
        </View>
      ) : null}

      <View style={styles.row}>
        <Button label="Exporter en CSV" variant="secondary" onPress={exportCsv} disabled={!list?.length} style={{ flex: 1 }} hint="Pour une note de frais : tableur, séparateur point-virgule" />
      </View>
      {msg ? <Notice>{msg}</Notice> : null}

      {list && !list.length ? (
        <View style={styles.empty}>
          <Text style={styles.h2}>Aucune recharge pour l’instant</Text>
          <Text style={styles.p}>Après chaque recharge suivie dans Branché, le reçu (borne, durée, kWh, montant payé) s’ajoute ici, sur votre téléphone.</Text>
          <Button label="Trouver une borne" onPress={() => router.replace('/')} />
        </View>
      ) : null}

      {list?.map((r) => (
        <View key={r.id} style={styles.item} accessibilityLabel={`Recharge du ${dateFr(r.startedAt)} à ${r.stationName}`}>
          <View style={styles.itemHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {r.stationName}
              </Text>
              <Text style={styles.small}>
                {dateFr(r.startedAt)} · {hour(r.startedAt)} · {durationLabel((r.endedAt - r.startedAt) / 60_000)}
                {r.pdcId ? ` · point …${r.pdcId.slice(-4)}` : ''}
              </Text>
            </View>
            <Text style={styles.amount}>{r.pricePaid != null ? euros(Math.round(r.pricePaid * 100)) : '—'}</Text>
          </View>
          <Text style={styles.small}>
            {r.operatorName} · {METHOD_LABEL[r.method]} · {r.kWh != null ? `${r.kWh.toLocaleString('fr-FR')} kWh${r.kWhEstimated ? ' (estimés)' : ''}` : 'kWh inconnus'}
            {r.ok === false ? ' · Échec signalé' : ''}
          </Text>
          {confirmId === r.id ? (
            <View style={styles.row}>
              <Button label="Supprimer" variant="secondary" onPress={async () => setList(await removeRecord(r.id))} style={styles.small2} />
              <Button label="Annuler" variant="ghost" onPress={() => setConfirmId(null)} style={styles.small2} />
            </View>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer la recharge du ${dateFr(r.startedAt)}`} onPress={() => setConfirmId(r.id)} style={styles.link}>
              <Text style={styles.linkDanger}>Supprimer</Text>
            </Pressable>
          )}
        </View>
      ))}

      {list?.length ? (
        confirmAll ? (
          <View style={{ gap: 8 }}>
            <Notice tone="error">Supprimer définitivement les {list.length} recharges de ce téléphone ?</Notice>
            <View style={styles.row}>
              <Button
                label="Tout supprimer"
                variant="secondary"
                onPress={async () => {
                  await clearHistory();
                  setList([]);
                  setConfirmAll(false);
                }}
                style={styles.small2}
              />
              <Button label="Annuler" variant="ghost" onPress={() => setConfirmAll(false)} style={styles.small2} />
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmAll(true)} style={styles.link}>
            <Text style={styles.linkDanger}>Tout supprimer</Text>
          </Pressable>
        )
      ) : null}
      <Text style={styles.small}>Historique stocké uniquement sur ce téléphone. Les montants sont ceux que vous avez saisis ; le justificatif officiel vient de l’opérateur.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 16, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: MIN_TOUCH, paddingHorizontal: 14 },
  h1: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  h2: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  stats: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  small2: { flex: 1, minHeight: 48 },
  empty: { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: 16, gap: 10 },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, gap: 4 },
  itemHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  itemTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  amount: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  linkDanger: { fontFamily: fonts.semibold, fontSize: 14, color: colors.danger },
});
