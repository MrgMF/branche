// Historique & dépenses : liste, total du mois, prix moyen au kWh, export CSV (note de frais), suppression.
// Tout est stocké sur l'appareil ; rien n'est envoyé.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice, Stat } from '../components/ui';
import { durationLabel } from '../lib/estimate';
import { euros } from '../lib/format';
import { clearHistory, loadHistory, methodLabel, monthStats, removeRecord, totals, updateRecord, type ChargeRecord } from '../lib/history';
import { exportHistoryCsv } from '../lib/historyExport';
import { SaveFailed } from '../components/SaveFailed';
import { loadTicket, removeTicket } from '../lib/ticket';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { ScreenHeader } from '../components/Screen';
import { useT } from '../i18n';
import { clock, dateShort, eur, kwhText } from '../i18n/format';

const dateFr = dateShort;
const hour = clock;
const perKwh = (x: number | null) => (x == null ? '—' : eur(x));

export default function Historique() {
  const t = useT();
  const H = t.history;
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<ChargeRecord[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState(false);

  useEffect(() => {
    loadHistory().then(setList);
  }, []);

  async function exportCsv() {
    if (!list?.length) return;
    const name = await exportHistoryCsv();
    if (name) setMsg(H.downloaded(name));
  }

  const m = list ? monthStats(list) : null;
  const all = list ? totals(list) : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
      <ScreenHeader title={t.titles.historique} />

      {m && list?.length ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.h2}>{H.thisMonth(m.month)}</Text>
          <View style={styles.stats}>
            <Stat label={H.spent} value={m.paidCount ? euros(Math.round(m.total * 100)) : '—'} />
            <Stat label={H.charges} value={String(m.count)} />
            <Stat label={H.avgKwh} value={perKwh(m.avgPerKwh)} />
          </View>
          {m.count > m.paidCount ? <Text style={styles.small}>{H.unpaid(m.count - m.paidCount)}</Text> : null}
          {all && all.count > m.count ? <Text style={styles.small}>{H.sinceStart(euros(Math.round(all.total * 100)), all.count)}</Text> : null}
        </View>
      ) : null}

      {list?.length ? (
      <View style={styles.row}>
        <Button label={H.export} variant="secondary" onPress={exportCsv} disabled={!list?.length} style={{ flex: 1 }} hint={H.exportHint} />
      </View>
      ) : null}
      {msg ? <Notice>{msg}</Notice> : null}

      {list && !list.length ? (
        <View style={styles.empty}>
          <Text style={styles.h2}>{H.emptyTitle}</Text>
          <Text style={styles.p}>{H.emptyBody}</Text>
          <Button label={t.common.findStation} onPress={() => router.replace('/')} />
        </View>
      ) : null}

      {list?.map((r) => (
        <View key={r.id} style={styles.item} accessibilityLabel={H.itemA11y(dateFr(r.startedAt), r.stationName)}>
          <View style={styles.itemHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {r.stationName}
              </Text>
              <Text style={styles.small}>
                {dateFr(r.startedAt)} · {hour(r.startedAt)}{r.notStarted ? '' : ` · ${durationLabel((r.endedAt - r.startedAt) / 60_000)}`}
                {r.pdcId ? H.point(r.pdcId.slice(-4)) : ''}
              </Text>
            </View>
            <Text style={styles.amount}>{r.pricePaid != null ? euros(Math.round(r.pricePaid * 100)) : '—'}</Text>
          </View>
          <Text style={styles.small}>
            {r.operatorName} · {methodLabel(r.method)}
            {r.notStarted ? H.notStarted : ` · ${r.kWh != null ? `${kwhText(r.kWh)}${r.kWhEstimated ? H.kwhEst : ''}` : H.kwhUnknown}${r.ok === false ? H.failed : ''}`}
          </Text>
          {r.ticket ? <TicketPhoto record={r} onRemoved={setList} onError={() => setSaveErr(true)} /> : null}
          {confirmId === r.id ? (
            <View style={styles.row}>
              <Button
                label={t.common.delete}
                variant="secondary"
                onPress={async () => {
                  setSaveErr(false);
                  await removeRecord(r.id).then(setList, () => setSaveErr(true));
                }}
                style={styles.small2}
              />
              <Button label={t.common.cancel} variant="ghost" onPress={() => setConfirmId(null)} style={styles.small2} />
            </View>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={H.delA11y(dateFr(r.startedAt))} onPress={() => setConfirmId(r.id)} style={styles.link}>
              <Text style={styles.linkDanger}>{t.common.delete}</Text>
            </Pressable>
          )}
        </View>
      ))}

      {list?.length ? (
        confirmAll ? (
          <View style={{ gap: 8 }}>
            <Notice tone="error">{H.delAllQ(list.length)}</Notice>
            <View style={styles.row}>
              <Button
                label={H.delAll}
                variant="secondary"
                onPress={async () => {
                  setSaveErr(false);
                  const ok = await clearHistory().then(() => true, () => false);
                  if (ok) setList([]);
                  else setSaveErr(true);
                  setConfirmAll(false);
                }}
                style={styles.small2}
              />
              <Button label={t.common.cancel} variant="ghost" onPress={() => setConfirmAll(false)} style={styles.small2} />
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmAll(true)} style={styles.link}>
            <Text style={styles.linkDanger}>{H.delAll}</Text>
          </Pressable>
        )
      ) : null}
      {saveErr ? <SaveFailed onChanged={() => loadHistory().then((l) => setList([...l]))} /> : null}
      <Text style={styles.small}>{H.footer}</Text>
    </ScrollView>
  );
}

/** Photo du ticket gardée sur ce téléphone : affichée à la demande, supprimable. */
function TicketPhoto({ record, onRemoved, onError }: { record: ChargeRecord; onRemoved: (l: ChargeRecord[]) => void; onError: () => void }) {
  const H = useT().history;
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const date = dateFr(record.startedAt);
  async function toggle() {
    if (!open && !uri) setUri(await loadTicket(record.id));
    setOpen((x) => !x);
  }
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={H.ticketShowA11y(date)} onPress={toggle} style={styles.link}>
        <Text style={styles.linkText}>{open ? H.ticketHide : H.ticketShow}</Text>
      </Pressable>
      {open ? (
        <>
          {uri ? <Image source={{ uri }} style={styles.ticket} resizeMode="contain" accessibilityLabel={H.ticketA11y(date)} /> : <Text style={styles.small}>{H.ticketGone}</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={H.ticketDelA11y(date)}
            onPress={async () => {
              await removeTicket(record.id);
              await updateRecord(record.id, { ticket: false }).then(onRemoved, onError);
            }}
            style={styles.link}
          >
            <Text style={styles.linkDanger}>{H.ticketDel}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  ticket: { width: '100%', height: 260, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  linkText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent },
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
