// « Enregistrement impossible » (stockage plein) : deux actions réelles pour libérer de la place sans rien perdre —
// exporter l'historique en CSV, ou supprimer les photos de tickets (les recharges restent dans l'historique).
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadHistory, removeAllTickets } from '../lib/history';
import { exportHistoryCsv } from '../lib/historyExport';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';
import { Button, Notice } from './ui';

export function SaveFailed({ dark, onChanged }: { dark?: boolean; onChanged?: () => void }) {
  const t = useT();
  const [records, setRecords] = useState(0);
  const [tickets, setTickets] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () =>
    loadHistory().then((l) => {
      setRecords(l.length);
      setTickets(l.filter((r) => r.ticket).length);
    });
  useEffect(() => {
    refresh();
  }, []);

  async function exportCsv() {
    const name = await exportHistoryCsv();
    if (name) setMsg(t.history.downloaded(name));
  }

  async function deleteTickets() {
    const n = await removeAllTickets();
    setConfirm(false);
    setMsg(n ? t.common.ticketsDeleted(n) : t.common.noTickets);
    await refresh();
    onChanged?.();
  }

  return (
    <View style={styles.wrap} role="alert" accessibilityLiveRegion="assertive">
      <Notice dark={dark} tone="error">
        {t.common.saveFailed}
      </Notice>
      <View style={styles.row}>
        {records ? <Button label={t.history.export} variant={dark ? 'light' : 'secondary'} onPress={exportCsv} style={styles.half} /> : null}
        {tickets && !confirm ? <Button label={t.common.deleteTickets} variant={dark ? 'light' : 'secondary'} onPress={() => setConfirm(true)} style={styles.half} /> : null}
      </View>
      {confirm ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.text, dark && { color: colors.nightText }]}>{t.common.deleteTicketsQ(tickets)}</Text>
          <View style={styles.row}>
            <Button label={t.common.deleteTicketsYes(tickets)} variant={dark ? 'light' : 'secondary'} onPress={deleteTickets} style={styles.half} />
            <Button label={t.common.cancel} variant="ghost" onPress={() => setConfirm(false)} style={styles.half} />
          </View>
        </View>
      ) : null}
      {msg ? <Text style={[styles.text, dark && { color: colors.nightText }]}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  half: { flexGrow: 1, flexBasis: 160 },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
});
