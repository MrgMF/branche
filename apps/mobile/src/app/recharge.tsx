// Suivi d'une recharge payée directement chez l'opérateur (lecteur de carte, QR vérifié, lien opérateur) :
// démarrage confirmé en un geste (sinon dépannage), estimation en direct, alertes, fin, reçu → historique.
// L'état est persisté : l'app peut être fermée et rouverte à tout moment.
import * as Location from 'expo-location';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CopyId } from '../components/CopyId';
import { NoCharge } from '../components/NoCharge';
import { Button, Notice } from '../components/ui';
import { loadWallet, markConnected } from '../lib/accounts';
import { apiEnabled } from '../lib/api';
import { sendCheckin } from '../lib/community';
import { durationLabel, estimateCharge, progressAt, type EstimateInput } from '../lib/estimate';
import { parseEuros, invalidAmount } from '../lib/amount';
import { euros } from '../lib/format';
import { autoFinish, departed, distanceToStation, recordOf, AUTO_END_M } from '../lib/autoEnd';
import { addRecord, methodLabel, updateRecord, type ChargeRecord } from '../lib/history';
import { saveTicket } from '../lib/ticket';
import { takeTicketPhoto } from '../lib/ticketPhoto';
import { postReport } from '../lib/navigation';
import { cancelAlerts, scheduleAlerts, type Alert } from '../lib/notify';
import { store, type DirectCharge } from '../lib/store';
import { planTariff } from '../lib/tariff';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { ScreenHeader } from '../components/Screen';
import { tr, useT } from '../i18n';
import { clock as clockFmt, kwhText, num } from '../i18n/format';

const clock = clockFmt;
const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
};
/** Saisie facultative : vide = OK ; hors de la forme `^\d{1,4}([.,]\d{1,2})?$` = erreur affichée, rien n'est enregistré. */
const invalid = invalidAmount;

function inputOf(d: DirectCharge): EstimateInput {
  const p = d.plan;
  return {
    vehicle: p?.vehicle ?? null,
    socPercent: p?.socPercent ?? null,
    pointKw: p?.pointKw ?? 0,
    plugs: p?.plugs ?? ['t2'],
    tariff: planTariff(p),
  };
}

export default function Recharge() {
  const t = useT();
  const C = t.recharge;
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<DirectCharge | null | undefined>(store.direct() ?? undefined);
  const [now, setNow] = useState(Date.now());
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [kwhIn, setKwhIn] = useState('');
  const [preauthIn, setPreauthIn] = useState('');
  const [details, setDetails] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<ChargeRecord | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [ticketMsg, setTicketMsg] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [queued, setQueued] = useState(false);
  // Échec d'écriture (historique, ticket, recharge en cours) : toujours dit à l'utilisateur
  const [saveErr, setSaveErr] = useState(false);
  const [persistErr, setPersistErr] = useState(store.directPersistFailed());
  useEffect(() => store.onDirectPersistError(() => setPersistErr(true)), []);

  useEffect(() => {
    if (d === undefined) store.loadDirect().then(setD);
  }, [d]);
  // Compte déjà confirmé auparavant : on ne repose pas la question
  useEffect(() => {
    const ask = d?.accountAsk;
    if (!ask) return;
    loadWallet().then((w) => {
      if (w.accounts.some((a) => a.operatorKey === ask.key)) update({ accountAsk: undefined });
    });
  }, [d?.accountAsk?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const charging = !!d?.chargeStartedAt && !d.endedAt;

  // Fin automatique : départ de la borne pendant la charge (position suivie sur l'appareil uniquement)
  useEffect(() => {
    if (!charging || !d) return;
    let cur = d;
    let stop = false;
    let sub: Location.LocationSubscription | null = null;
    const onFix = async (lat: number, lon: number, speed: number | null, resume: boolean) => {
      if (stop || cur.endedAt) return;
      const fix = { lat, lon, speed, at: Date.now() };
      const m = distanceToStation(cur, fix);
      if (m != null && m <= AUTO_END_M) {
        if (!cur.lastNearAt || fix.at - cur.lastNearAt > 60_000) {
          cur = { ...cur, lastNearAt: fix.at };
          store.setDirect(cur);
        }
        return;
      }
      if (departed(cur, fix, resume)) {
        stop = true;
        const next = await autoFinish(cur);
        store.setDirect(next);
        setD(next);
      }
    };
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted || stop) return;
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 25, timeInterval: 15_000 }, (p) =>
          onFix(p.coords.latitude, p.coords.longitude, p.coords.speed ?? null, false),
        );
      } catch {
        /* position indisponible : fin manuelle seulement */
      }
    })();
    // Retour dans l'app : état rafraîchi, et départ constaté si l'utilisateur est loin de la borne
    const app = AppState.addEventListener('change', async (st) => {
      if (st !== 'active') return;
      setNow(Date.now());
      try {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        onFix(p.coords.latitude, p.coords.longitude, p.coords.speed ?? null, true);
      } catch {
        /* rien */
      }
    });
    return () => {
      stop = true;
      sub?.remove();
      app.remove();
    };
  }, [charging, d?.chargeStartedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!charging) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [charging]);

  const input = useMemo(() => (d ? inputOf(d) : null), [d]);
  const est = useMemo(() => (input ? estimateCharge(input) : null), [input]);
  const tariff = input?.tariff;

  const update = (patch: Partial<DirectCharge> | null) => {
    const next = patch && d ? { ...d, ...patch } : null;
    store.setDirect(next);
    setD(next);
    setNow(Date.now());
    return next;
  };

  async function started() {
    if (!d || !est || !tariff) return;
    const t0 = Date.now();
    const endAt = t0 + est.minutes * 60_000;
    const N = tr().recharge;
    const alerts: Alert[] = [{ at: endAt, title: N.endTitle, body: N.endBody(d.station.name) }];
    if (tariff.idle) {
      const idleAt = endAt + tariff.idle.afterMin * 60_000;
      alerts.push({ at: idleAt - 5 * 60_000, title: N.idleTitle, body: N.idleBody(d.operatorName, clock(idleAt)) });
    }
    if (tariff.perMinLater) {
      alerts.push({ at: t0 + (tariff.perMinLater.afterMin - 5) * 60_000, title: N.perMinTitle, body: N.perMinBody(tariff.perMinLater.afterMin, d.operatorName) });
    }
    const next = update({ chargeStartedAt: t0 });
    const ids = await scheduleAlerts(alerts);
    if (next && ids.length) {
      const withIds = { ...next, alertIds: ids };
      store.setDirect(withIds);
      setD(withIds);
    }
  }

  function finish() {
    if (!d) return;
    cancelAlerts(d.alertIds);
    update({ endedAt: Date.now(), alertIds: [] });
  }

  async function reportDown() {
    if (!d) return;
    setMsg(null);
    if (d.station.id !== 'inconnue') sendCheckin({ stationId: d.station.id, ok: false });
    if (!apiEnabled() || d.station.lat == null || d.station.lon == null) {
      setMsg(C.reportPhone);
      return;
    }
    try {
      await postReport('borne_hs', { lat: d.station.lat, lon: d.station.lon });
      setMsg(C.reportOk);
    } catch {
      setMsg(C.reportFail);
    }
  }

  async function answerAccount(yes: boolean) {
    const ask = d?.accountAsk;
    if (!ask) return;
    if (yes) await markConnected(ask.key, ask.name);
    update({ accountAsk: undefined });
  }

  async function addTicket() {
    setTicketMsg(null);
    try {
      const r = await takeTicketPhoto();
      if (!r) return;
      if ('error' in r) setTicketMsg(r.error === 'tooBig' ? C.ticketTooBig : C.ticketFailed);
      else setTicket(r.data);
    } catch {
      setTicketMsg(C.ticketFailed);
    }
  }

  async function save() {
    if (!d || !est) return;
    setTried(true);
    if (invalid(paid) || invalid(kwhIn) || invalid(preauthIn)) return;
    const ended = d.endedAt ?? Date.now();
    const kWh = parseEuros(kwhIn);
    const pricePaid = parseEuros(paid);
    const preauth = parseEuros(preauthIn);
    const base = recordOf(d, ended);
    let r: ChargeRecord = { ...base, kWh: kWh ?? base.kWh, kWhEstimated: kWh == null, pricePaid, ok };
    setSaveErr(false);
    try {
      await addRecord(r);
    } catch {
      setSaveErr(true); // reçu non enregistré : on reste sur l'écran de fin, « Enregistrer » réessaie
      return;
    }
    if (ticket) {
      const stored = await saveTicket(r.id, ticket);
      const linked = stored && (await updateRecord(r.id, { ticket: true }).then(() => true, () => false));
      if (linked) r = { ...r, ticket: true };
      else setTicketMsg(C.ticketFull);
    }
    if (ok != null && d.station.id !== 'inconnue') {
      sendCheckin({ stationId: d.station.id, ok, ...(pricePaid != null ? { pricePaid } : {}), ...(kWh != null ? { kWh } : {}), ...(preauth != null ? { preauth } : {}) }).then(
        (res) => res === 'queued' && setQueued(true),
      );
    }
    store.setPlan(null);
    update(null);
    setSaved(r);
  }

  if (saved) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card} accessibilityLabel={C.receipt}>
          <Text style={styles.cardTitle} accessibilityRole="header">{C.receiptTitle}</Text>
          <Row k={C.station} v={saved.stationName} />
          {saved.pdcId ? <Row k={C.point} v={`…${saved.pdcId.slice(-4)}`} /> : null}
          <Row k={C.paidTo} v={saved.operatorName} />
          <Row k={C.method} v={methodLabel(saved.method)} />
          <Row k={C.duration} v={durationLabel((saved.endedAt - saved.startedAt) / 60_000)} />
          <Row k={saved.kWhEstimated ? C.energyEst : C.energy} v={saved.kWh != null ? kwhText(saved.kWh) : '—'} />
          <Row k={C.paid} v={saved.pricePaid != null ? euros(Math.round(saved.pricePaid * 100)) : t.common.notProvided} strong />
          {saved.ticket && ticket ? <Image source={{ uri: ticket }} style={styles.ticket} resizeMode="contain" accessibilityLabel={C.ticketA11y} /> : null}
          <Text style={styles.mutedLeft}>{C.keptHere(saved.operatorName)}</Text>
        </View>
        {ticketMsg ? <Notice dark tone="error">{ticketMsg}</Notice> : null}
        {queued ? <Notice dark>{C.queued}</Notice> : null}
        <Button label={C.seeHistory} onPress={() => router.replace('/historique')} />
        <Button label={t.common.backToMap} variant="light" onPress={() => router.replace('/')} />
      </ScrollView>
    );
  }

  if (d === undefined) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.charge} />
      </View>
    );
  }
  if (!d || !est || !input) {
    return (
      <ScrollView style={[styles.root, { backgroundColor: colors.surface }]} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
        <ScreenHeader title={t.titles.maRecharge} />
        <NoCharge />
      </ScrollView>
    );
  }

  const reader = !d.url;
  const reopen = () => (Platform.OS === 'web' ? window.open(d.url, '_blank', 'noopener,noreferrer') : WebBrowser.openBrowserAsync(d.url));
  const tel = d.station.tel ? () => Linking.openURL(`tel:${d.station.tel!.replace(/[^+\d]/g, '')}`) : null;
  const elapsedMs = d.chargeStartedAt ? (d.endedAt ?? now) - d.chargeStartedAt : 0;
  const prog = progressAt(input, elapsedMs / 60_000);
  const endAt = d.chargeStartedAt ? d.chargeStartedAt + est.minutes * 60_000 : 0;
  const idleAt = tariff?.idle && endAt ? endAt + tariff.idle.afterMin * 60_000 : null;
  const span = Math.max(1, est.toSoc - est.fromSoc);
  const pct = Math.min(1, Math.max(0, (prog.soc - est.fromSoc) / span));
  const pointText = d.plan?.pdcId ? C.pointSuffix(d.plan.pdcId.slice(-4)) : '';

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
      <ScreenHeader dark title={t.titles.maRecharge} sub={`${d.station.name}${pointText}`} />
      {persistErr || d.saveFailed ? (
        <Notice dark tone="error">
          {t.common.saveFailed}
        </Notice>
      ) : null}

      {d.accountAsk ? (
        <View style={[styles.card, styles.ask]} accessibilityLiveRegion="polite">
          <Text style={styles.cardTitle} accessibilityRole="header">{C.accountQ(d.accountAsk.name)}</Text>
          <Text style={styles.mutedLeft}>{C.accountBody}</Text>
          <Button label={t.accounts.yesConnected} onPress={() => answerAccount(true)} />
          <Button label={t.accounts.notNow} variant="ghost" onPress={() => answerAccount(false)} />
        </View>
      ) : null}

      {!d.chargeStartedAt && !help ? (
        <>
          <View style={styles.ring}>
            <Text style={styles.stateBig} accessibilityRole="header">
              {d.plan?.method === 'badge' ? C.stateBadge : d.plan?.method === 'account' ? C.stateAccount(d.operatorName) : reader ? C.stateReader : C.statePage(d.operatorName)}
            </Text>
            <Text style={styles.muted}>
              {d.plan?.method === 'badge'
                ? C.bodyBadge
                : d.plan?.method === 'account'
                  ? C.bodyAccount(d.operatorName)
                  : reader
                    ? C.bodyReader(d.plan?.pdcId ? d.plan.pdcId.slice(-4) : null)
                    : C.bodyPage(d.operatorName)}
            </Text>
          </View>
          {!reader && d.plan?.pdcId && (d.plan.method === 'operator-link' || d.plan.method === 'account') ? <CopyId id={d.plan.pdcId} dark /> : null}
          <Button label={C.started} onPress={started} hint={C.startedHint} />
          <Button label={C.notStarting} variant="light" onPress={() => setHelp(true)} hint={C.notStartingHint} />
          {!reader ? <Button label={C.reopen(d.operatorName)} variant="ghost" onPress={reopen} /> : null}
        </>
      ) : null}

      {!d.chargeStartedAt && help ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">{C.helpTitle}</Text>
            <Text style={styles.mutedLeft}>{C.helpBody}</Text>
          </View>
          <Button label={C.otherPoint} variant="light" onPress={() => router.replace({ pathname: '/recharger', params: { station: d.station.id, step: 'point' } })} />
          <Button label={C.otherMethod} variant="light" onPress={() => router.replace({ pathname: '/recharger', params: { station: d.station.id } })} />
          {tel ? <Button label={C.call(d.operatorName)} variant="light" onPress={tel} hint={d.station.tel} /> : null}
          <Button label={C.reportDown} variant="light" onPress={reportDown} hint={C.reportDownHint} />
          {msg ? <Notice dark>{msg}</Notice> : null}
          <Button label={C.startedAfterAll} variant="ghost" onPress={started} />
          <Button
            label={C.abandon}
            variant="ghost"
            onPress={() => {
              cancelAlerts(d.alertIds);
              update(null);
              router.replace('/');
            }}
          />
        </>
      ) : null}

      {charging ? (
        <>
          <View style={styles.ring} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: prog.soc }}>
            <Text style={styles.big}>{prog.soc} %</Text>
            <Text style={styles.state}>{prog.done ? C.goalReached(est.toSoc) : C.charging(est.toSoc, clock(endAt))}</Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <View style={styles.stats}>
              <Stat label={C.energy} value={kwhText(prog.kWhBilled)} />
              <Stat label={C.costEst} value={prog.cost != null ? euros(Math.round(prog.cost * 100)) : '—'} a11y={prog.cost != null ? undefined : `${C.costEst} : ${t.common.unknownPrice}`} />
              <Stat label={C.elapsed} value={fmt(elapsedMs)} />
            </View>
            {prog.cost == null ? <Text style={styles.small}>{`${C.costEst} : ${t.common.unknownPrice}`}</Text> : null}
            <Text style={styles.muted}>
              {C.estimateNote(d.plan?.vehicle?.name ?? null, est.fromSoc, `${num(est.powerKw)} kW`, d.operatorName)}
            </Text>
          </View>
          {prog.done ? <Notice tone="demo">{C.unplug(est.toSoc, !!idleAt)}</Notice> : null}
          {idleAt ? (
            <Notice tone="demo">
              {C.idleNotice(clock(idleAt), `${num(tariff!.idle!.perMin, 3)} €/min`)}
            </Notice>
          ) : (
            <Notice dark>{C.freeSpot}</Notice>
          )}
          {d.alertIds?.length ? <Text style={styles.small}>{C.reminder(!!idleAt)}</Text> : null}
          <Button label={C.done} onPress={finish} />
          {!reader ? <Button label={C.reopen(d.operatorName)} variant="ghost" onPress={reopen} /> : null}
          {tel ? <Button label={C.problemCall(d.operatorName)} variant="ghost" onPress={tel} /> : null}
        </>
      ) : null}

      {d.endedAt ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">{C.endedTitle}</Text>
            {d.autoEnded ? <Text style={styles.mutedLeft}>{C.autoEnded(clock(d.endedAt))}</Text> : null}
            <Row k={C.duration} v={fmt(elapsedMs)} />
            <Row k={C.energyEstimated} v={kwhText(prog.kWhBilled)} />
            <Row k={C.costEst} v={prog.cost != null ? euros(Math.round(prog.cost * 100)) : t.common.unknownPrice} />
          </View>

          <View style={styles.card}>
            <Text style={styles.label} nativeID="ok-label">{C.worked}</Text>
            <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabelledBy="ok-label">
              {[
                { v: true, l: t.common.yes },
                { v: false, l: t.common.no },
              ].map((c) => (
                <Pressable
                  key={c.l}
                  role="radio"
                  aria-checked={ok === c.v}
                  accessibilityState={{ checked: ok === c.v }}
                  accessibilityLabel={c.l}
                  onPress={() => setOk(c.v)}
                  style={[styles.choice, ok === c.v && styles.choiceOn]}
                >
                  <Text style={[styles.choiceText, ok === c.v && { color: colors.nightBg }]}>{c.l}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.small}>{C.workedNote}</Text>

            <Text style={styles.label} nativeID="paid-label">{C.paidQ}</Text>
            <TextInput
              value={paid}
              onChangeText={setPaid}
              placeholder={C.paidPh}
              placeholderTextColor={colors.nightMuted}
              keyboardType="decimal-pad"
              aria-label={C.paidA11y}
              accessibilityLabelledBy="paid-label"
              style={[styles.input, (tried || paid.length > 2) && invalid(paid) && styles.inputBad]}
              aria-invalid={invalid(paid)}
            />
            {(tried || paid.length > 2) && invalid(paid) ? (
              <Text style={styles.error} accessibilityLiveRegion="polite" role="alert">
                {C.amountInvalid}
              </Text>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails((x) => !x)} style={styles.link}>
              <Text style={styles.linkText}>{details ? C.less : C.more}</Text>
            </Pressable>
            {details ? (
              <>
                <TextInput value={kwhIn} onChangeText={setKwhIn} placeholder={C.kwhPh(num(prog.kWhBilled))} placeholderTextColor={colors.nightMuted} keyboardType="decimal-pad" aria-label={C.kwhA11y} aria-invalid={invalid(kwhIn)} style={[styles.input, tried && invalid(kwhIn) && styles.inputBad]} />
                {tried && invalid(kwhIn) ? <Text style={styles.error} role="alert">{C.kwhInvalid}</Text> : null}
                <TextInput value={preauthIn} onChangeText={setPreauthIn} placeholder={C.preauthPh} placeholderTextColor={colors.nightMuted} keyboardType="decimal-pad" aria-label={C.preauthA11y} aria-invalid={invalid(preauthIn)} style={[styles.input, tried && invalid(preauthIn) && styles.inputBad]} />
                {tried && invalid(preauthIn) ? <Text style={styles.error} role="alert">{C.preauthInvalid}</Text> : null}
              </>
            ) : null}

            <Text style={styles.label}>{C.ticketTitle}</Text>
            {ticket ? (
              <>
                <Image source={{ uri: ticket }} style={styles.ticket} resizeMode="contain" accessibilityLabel={C.ticketA11y} />
                <Pressable accessibilityRole="button" onPress={() => setTicket(null)} style={styles.link}>
                  <Text style={styles.linkDanger}>{C.ticketRemove}</Text>
                </Pressable>
              </>
            ) : (
              <Button label={C.ticketTake} variant="light" onPress={addTicket} hint={C.ticketHint} />
            )}
            <Text style={styles.small}>{C.ticketHint}</Text>
            {ticketMsg ? <Text style={styles.error} role="alert">{ticketMsg}</Text> : null}
          </View>
          {saveErr ? (
            <Notice dark tone="error">
              {t.common.saveFailed}
            </Notice>
          ) : null}
          <Button label={C.save} onPress={save} hint={C.saveHint} />
          <Button label={C.resume} variant="ghost" onPress={() => update({ endedAt: null, autoEnded: false })} />
        </>
      ) : null}
    </ScrollView>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowK, strong && styles.strong]}>{k}</Text>
      <Text style={[styles.rowV, strong && styles.strong]} numberOfLines={2}>
        {v}
      </Text>
    </View>
  );
}

/** Valeur sur 2 lignes au plus, jamais tronquée par « … » (montants longs, petites largeurs, grandes polices). */
function Stat({ label, value, a11y }: { label: string; value: string; a11y?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={a11y ?? `${label} : ${value}`}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.nightBg },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  body: { paddingHorizontal: 16, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: MIN_TOUCH, paddingHorizontal: 14 },
  title: { fontFamily: fonts.display, fontSize: 22, color: '#F2F6F4' },
  station: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.nightMuted },
  ring: { alignItems: 'center', gap: 10, paddingVertical: 24, paddingHorizontal: 14, borderRadius: radius.xl, backgroundColor: colors.nightCard },
  big: { fontFamily: fonts.display, fontSize: 52, color: '#F2F6F4' },
  stateBig: { fontFamily: fonts.display, fontSize: 22, color: '#F2F6F4', textAlign: 'center' },
  state: { fontFamily: fonts.bold, fontSize: 16, color: colors.charge, textAlign: 'center' },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.nightMuted, lineHeight: 20, textAlign: 'center' },
  mutedLeft: { fontFamily: fonts.medium, fontSize: 14, color: colors.nightMuted, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.nightMuted },
  bar: { width: '90%', height: 8, borderRadius: 4, backgroundColor: '#24342F', overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.charge },
  stats: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  stat: { flex: 1, backgroundColor: colors.nightBg, borderRadius: radius.md, padding: 10, gap: 2 },
  statLabel: { fontFamily: fonts.semibold, fontSize: 11, color: colors.nightMuted },
  statValue: { fontFamily: fonts.display, fontSize: 16, color: '#F2F6F4' },
  card: { backgroundColor: colors.nightCard, borderRadius: radius.lg, padding: 16, gap: 10 },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: '#F2F6F4' },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: '#F2F6F4' },
  choices: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, minHeight: 52, borderRadius: radius.md, borderWidth: 2, borderColor: colors.nightMuted, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: colors.charge, borderColor: colors.charge },
  choiceText: { fontFamily: fonts.bold, fontSize: 17, color: '#F2F6F4' },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: '#3A4A45', paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 16, color: '#F2F6F4', backgroundColor: colors.nightBg },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.charge },
  linkDanger: { fontFamily: fonts.semibold, fontSize: 15, color: '#FF9C9C' },
  inputBad: { borderColor: '#FF9C9C', borderWidth: 2 },
  error: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: '#FFB4B4' },
  ticket: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.nightBg },
  ask: { borderWidth: 2, borderColor: colors.charge },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowK: { fontFamily: fonts.medium, fontSize: 15, color: colors.nightMuted },
  rowV: { flex: 1, textAlign: 'right', fontFamily: fonts.semibold, fontSize: 15, color: '#F2F6F4' },
  strong: { color: '#F2F6F4', fontFamily: fonts.bold, fontSize: 17 },
});
