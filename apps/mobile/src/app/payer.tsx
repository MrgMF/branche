import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PriceSummary } from '../components/Pricing';
import { Button, Notice } from '../components/ui';
import { apiEnabled } from '../lib/api';
import { getCommunity, type Community } from '../lib/community';
import { DEV_HOSTS } from '../lib/config';
import { postReport } from '../lib/navigation';
import { directPayUrl, openOperatorPayment, operatorLabel, operatorOf, startReaderCharge } from '../lib/connectors';
import { payLabel } from '../lib/format';
import type { MethodId } from '../lib/history';
import { verifyQr, type Operator, type QrResult } from '../lib/qr';
import { findStation, pointById, pointsOf, type ChargePoint } from '../lib/evse';
import { payOptions, reader2027Applies } from '../lib/methods';
import { loadPortals, preauthMaxOf, type Portals } from '../lib/portals';
import { evseInText, qrTarget, type QrTarget } from '../lib/qrTarget';
import { displayName, loadOperators, type Station } from '../lib/stations';
import { loadVehicle, type Vehicle } from '../lib/vehicle';
import { store } from '../lib/store';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { ScreenHeader } from '../components/Screen';
import { useT } from '../i18n';

const PAYABLE = new Set<QrResult['verdict']>(['official', 'known-operator']);
const WARN = { bg: colors.warnSoft, fg: colors.warnText };
const OK = { bg: colors.accentSoft, fg: colors.accentPressed };
const TONE: Record<QrResult['verdict'], { bg: string; fg: string }> = {
  official: OK,
  'known-operator': OK,
  'payment-platform': WARN,
  'other-operator': WARN,
  unknown: WARN,
  dangerous: { bg: colors.dangerSoft, fg: colors.danger },
};

export default function Payer() {
  const t = useT();
  const P = t.payer;
  const insets = useSafeAreaInsets();
  const [station, setStation] = useState<Station | null>(store.current());
  const [ops, setOps] = useState<Operator[]>([]);
  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<QrResult | null>(null);
  const [confirmUnknown, setConfirmUnknown] = useState(false);
  const locked = useRef(false);
  const [reported, setReported] = useState<string | null>(null);
  // QR code d'un autre point ou d'une autre borne : confirmation explicite, jamais de bascule silencieuse
  const [mismatch, setMismatch] = useState<Extract<QrTarget, { kind: 'point' | 'station' }> | null>(null);
  const [lastRaw, setLastRaw] = useState('');
  const [scannedPdc, setScannedPdc] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [portals, setPortals] = useState<Portals>({});
  const [offline, setOffline] = useState(false);
  const params = useLocalSearchParams<{ from?: string }>();
  const [plan, setPlanState] = useState(store.plan());
  const planPoint = station && plan?.stationId === station.id ? pointById(station, plan.pdcId) : undefined;
  // Pas de parcours « Recharger » avant (scan depuis l'accueil) : résumé prix + estimation avant « Payer »
  const fromHome = !planPoint;
  const pts = station ? pointsOf(station) : [];
  const summaryPoint: ChargePoint | undefined = (station && scannedPdc ? pointById(station, scannedPdc) : undefined) ?? planPoint ?? (pts.length === 1 ? pts[0] : undefined);

  // Depuis le parcours « Recharger » sur téléphone : appareil photo ouvert d'office (un geste de moins)
  useEffect(() => {
    if (params.from === 'recharger' && Platform.OS !== 'web') startScan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function reportQr() {
    const at = station ?? store.current();
    if (!at || !apiEnabled()) {
      setReported(P.reportPhone);
      return;
    }
    try {
      await postReport('qr_suspect', at);
      setReported(P.reportOk);
    } catch {
      setReported(P.reportFail);
    }
  }

  useEffect(() => {
    loadOperators().then(setOps);
    loadPortals().then(setPortals);
    loadVehicle().then(setVehicle).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (station) getCommunity(station.id).then(setCommunity);
  }, [station]);

  const opName = operatorLabel(station, ops);
  const knownUrl = station ? directPayUrl(station, ops) : null;

  /** Voies officielles de la borne (page de paiement connue, lecteur CB déclaré) : un lien Stripe/SumUp y est bloqué. */
  function officialOf(st: Station | null) {
    if (!st) return undefined;
    const o = payOptions(st, st.id === station?.id ? (planPoint ?? summaryPoint ?? null) : null, ops, { portals });
    const rd = o.find((x) => x.id === 'reader');
    return { page: !!o.find((x) => x.id === 'operator-link')?.available, reader: !!rd?.available && !rd.speculative };
  }

  async function check(raw: string, override?: Station) {
    let at = override ?? station;
    setLastRaw(raw);
    setOffline(false);
    let r = verifyQr(raw, at?.ok ?? null, ops, { devHosts: DEV_HOSTS, official: officialOf(at) });
    // Identifiant de point : QR code « identifiant seul », ou dans le lien (…?evse=FR*ABC*E123)
    const evse = r.kind === 'evse' ? (r.evse ?? null) : /^https?:/i.test(raw.trim()) ? evseInText(raw) : null;
    const chosenPdc = at && plan?.stationId === at.id ? (plan.pdcId ?? null) : null;
    const local = at && evse ? pointById(at, evse) : undefined;
    const found = evse && !local ? await findStation(evse, store.stations()) : null;
    const target = qrTarget(at, chosenPdc, evse, found);
    if (target.kind === 'select') {
      at = target.station;
      setStation(at);
      store.setCurrent(at);
      r = verifyQr(raw, at.ok ?? null, ops, { devHosts: DEV_HOSTS, official: officialOf(at) });
    }
    if (r.kind === 'evse' && r.evse) {
      if (target.kind === 'select' || target.kind === 'same') {
        // Le QR ne contient que l'identifiant : on ouvre le parcours sur ce point, sans lien de paiement.
        setScanning(false);
        router.replace({ pathname: '/recharger', params: { evse: r.evse, noLink: '1' } });
        return;
      }
      if (target.kind === 'none') {
        r.verdict = 'unknown';
        r.reasons = [t.qr.evseUnknown];
      }
    }
    setMismatch(target.kind === 'point' || target.kind === 'station' ? target : null);
    if (target.kind === 'same' && target.point) setScannedPdc(target.point.id);
    else if (target.kind === 'select') setScannedPdc(target.pdcId);
    setConfirmUnknown(false);
    setReported(null);
    setResult(r);
    setScanning(false);
  }

  /** L'utilisateur confirme le point ou la borne du QR code. */
  function acceptMismatch() {
    if (!mismatch || !result) return;
    if (mismatch.kind === 'point') {
      const pt = mismatch.point;
      const pl = store.plan();
      if (pl && station && pl.stationId === station.id) {
        const next = { ...pl, pdcId: pt.id, pointKw: pt.kw, plugs: pt.plugs };
        store.setPlan(next);
        setPlanState(next);
      }
      setScannedPdc(pt.id);
      setMismatch(null);
      if (result.kind === 'evse') router.replace({ pathname: '/recharger', params: { evse: pt.id, noLink: '1' } });
      return;
    }
    const next = mismatch.station;
    setStation(next);
    store.setCurrent(next);
    store.setPlan(null);
    setPlanState(null);
    setScannedPdc(mismatch.pdcId);
    setMismatch(null);
    if (result.kind === 'evse') router.replace({ pathname: '/recharger', params: { evse: mismatch.pdcId ?? next.id, noLink: '1' } });
    else check(lastRaw, next);
  }

  function rejectMismatch() {
    setMismatch(null);
    setResult(null);
    setManual('');
  }

  /** Paiement depuis l'accueil : le suivi reprend le point et le tarif vus dans le résumé. */
  function planFromHome(method: MethodId) {
    if (station && fromHome && summaryPoint) {
      const fresh = vehicle && Date.now() - vehicle.socUpdatedAt < 3 * 3600_000 ? vehicle.socPercent : null;
      store.setPlan({
        stationId: station.id,
        pdcId: summaryPoint.id,
        pointKw: summaryPoint.kw,
        plugs: summaryPoint.plugs,
        method,
        socPercent: fresh,
        vehicle: vehicle ? { name: vehicle.name, batteryKWh: vehicle.batteryKWh, maxDcKW: vehicle.maxDcKW, maxAcKW: vehicle.maxAcKW } : null,
        tariffRaw: station.prix,
        free: station.free,
        stationKw: station.kw,
        pay: station.pay,
      });
    } else {
      // Parcours « Recharger » : la méthode réellement utilisée (voie officielle proposée) est reprise par le suivi
      const pl = store.plan();
      if (pl && station && pl.stationId === station.id && pl.method !== method) store.setPlan({ ...pl, method });
    }
  }

  /** Sans réseau, rien n'est ouvert : « Pas de réseau : payez au lecteur CB ou réessayez ». */
  function pay(url: string, name: string, method: MethodId = 'scan') {
    planFromHome(method);
    setOffline(false);
    openOperatorPayment(url, station, name).then((r) => setOffline(r === 'offline'));
  }

  /** Voie officielle proposée à la place d'un lien bloqué (page connue de l'opérateur ou lecteur CB de la borne). */
  function payAtReader() {
    if (!station) return;
    planFromHome('reader');
    startReaderCharge(station, opName);
  }

  function onScan(e: BarcodeScanningResult) {
    if (locked.current) return;
    locked.current = true;
    check(e.data);
    setTimeout(() => (locked.current = false), 1500);
  }

  async function startScan() {
    setResult(null);
    if (!perm?.granted) {
      const p = await requestPerm();
      if (!p.granted) return;
    }
    setScanning(true);
  }

  const payName = result?.operatorKey ? (ops.find((o) => o.key === result.operatorKey)?.names[0] ?? opName) : opName;
  const tone = result ? (mismatch ? WARN : TONE[result.verdict]) : null;
  // Lecteur de carte : une seule source de vérité, l'option « reader » de payOptions (IRVE, ou « certains sites »)
  const reader = station ? payOptions(station, planPoint ?? summaryPoint ?? null, ops, { portals }).find((o) => o.id === 'reader') : undefined;
  const readerConfirmed = !!reader?.available && !reader.speculative;
  const atStation = readerConfirmed ? (station?.pay.filter((p) => p === 'cb' || p === 'sans_contact').map((p) => payLabel(p)) ?? []) : [];
  // Obligation AFIR (lecteur de carte) : seulement pour les bornes ≥ 50 kW
  const refKw = summaryPoint?.kw ?? planPoint?.kw ?? station?.kw ?? 0;
  const readerLines: string[] = !station || !reader
    ? []
    : readerConfirmed
      ? [atStation.length ? P.reader(atStation) : reader.why]
      : [...(reader.speculative ? [reader.why] : []), ...(reader2027Applies(refKw) ? [P.reader2027] : reader.speculative ? [] : [P.readerNone])];
  const portal = station?.ok ? portals[station.ok] : undefined;
  const title = !result
    ? ''
    : result.kind === 'evse'
      ? result.verdict === 'unknown'
        ? P.evseDiff
        : P.evseOk
      : result.source === 'site' && result.verdict === 'unknown'
        ? P.toneSiteUnverified
      : result.source === 'portal' && result.verdict === 'official'
        ? P.toneOfficialPay
        : result.source === 'site' && result.verdict === 'official'
          ? P.toneOfficialSite
        : result.source === 'portal' && result.verdict === 'known-operator'
          ? P.toneKnownPay
          : P.tone[result.verdict];
  const canPay = !!result && !mismatch && result.kind === 'url' && PAYABLE.has(result.verdict) && !!result.url;
  const canConfirm = !!result && !mismatch && result.kind === 'url' && (result.verdict === 'unknown' || result.verdict === 'other-operator' || result.verdict === 'payment-platform') && !!result.url;
  // Lien bloqué alors qu'une voie officielle existe : cette voie, proposée en un geste
  const officialLink = station ? payOptions(station, planPoint ?? summaryPoint ?? null, ops, { portals }).find((o) => o.id === 'operator-link' && o.available)?.url : undefined;
  const summary = fromHome && station && summaryPoint && (canPay || canConfirm) ? <PriceSummary station={station} point={summaryPoint} vehicle={vehicle} community={community} preauthMax={preauthMaxOf(portal)} /> : null;

  return (
    <ScrollView style={{ backgroundColor: colors.surface }} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <ScreenHeader title={t.titles.payer} sub={station ? `${displayName(station)} · ${opName}` : undefined} />
      {planPoint ?? summaryPoint ? <Text style={styles.point}>{t.common.point((planPoint ?? summaryPoint)!.short)}</Text> : null}

      <Text style={styles.p}>{P.intro(opName)}</Text>

      {knownUrl ? (
        <Button label={P.openPay(opName)} onPress={() => pay(knownUrl, opName)} hint={P.openPayHint} />
      ) : null}

      {scanning ? (
        <View style={styles.camWrap}>
          <CameraView style={styles.cam} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
          <View pointerEvents="none" style={styles.frame} />
          <Button label={P.stopScan} variant="light" onPress={() => setScanning(false)} style={styles.stop} />
        </View>
      ) : (
        <Button
          label={t.recharger.scanQr}
          variant={knownUrl ? 'secondary' : 'primary'}
          onPress={startScan}
          hint={P.scanHint}
        />
      )}
      {perm && !perm.granted && !perm.canAskAgain ? (
        <Notice tone="error">{P.camDenied}</Notice>
      ) : null}

      <View style={styles.manual}>
        <Text style={styles.label} nativeID="manual-label">
          {P.manualLabel}
        </Text>
        <View style={styles.row}>
          <TextInput
            value={manual}
            onChangeText={setManual}
            placeholder={P.manualPh}
            placeholderTextColor="#7A8682"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabelledBy="manual-label"
            aria-label={P.manualA11y}
            style={styles.input}
            onSubmitEditing={() => manual.trim() && check(manual)}
            returnKeyType="go"
          />
          <Button label={P.verify} variant="ghost" onPress={() => check(manual)} disabled={!manual.trim()} style={styles.verify} />
        </View>
      </View>

      {result && tone ? (
        <View style={[styles.result, { backgroundColor: tone.bg }]} accessibilityLiveRegion="polite">
          <Text style={[styles.resultTitle, { color: tone.fg }]}>{title}</Text>
          {result.host ? <Text style={[styles.domain, { color: tone.fg }]}>{result.host}</Text> : null}
          {result.reasons.map((r) => (
            <Text key={r} style={[styles.reason, { color: tone.fg }]}>
              {r}
            </Text>
          ))}

          {mismatch ? (
            <View style={styles.mismatch} accessibilityLiveRegion="assertive">
              <Text style={[styles.resultTitle, { color: tone.fg }]} accessibilityRole="header">
                {mismatch.kind === 'point' ? P.otherPoint(mismatch.point.short, mismatch.chosen.short) : P.otherStation(displayName(mismatch.station))}
              </Text>
              <Text style={[styles.reason, { color: tone.fg }]}>{P.mismatchHelp}</Text>
              <Button
                label={mismatch.kind === 'point' ? P.usePoint(mismatch.point.short) : P.useStation(displayName(mismatch.station))}
                variant="secondary"
                onPress={acceptMismatch}
              />
              <Button label={P.keepChoice} variant="ghost" onPress={rejectMismatch} />
            </View>
          ) : null}

          {canPay || canConfirm ? summary : null}
          {canPay ? <Text style={[styles.reason, { color: tone.fg }]}>{P.printed}</Text> : null}
          {canPay ? <Button label={P.payOn(payName)} onPress={() => pay(result.url!, payName)} /> : null}

          {canConfirm ? (
            <>
              <Text style={[styles.reason, { color: tone.fg }]}>
                {P.checkSticker}
              </Text>
              <Pressable
                role="checkbox"
                aria-checked={confirmUnknown}
                accessibilityState={{ checked: confirmUnknown }}
                onPress={() => setConfirmUnknown((v) => !v)}
                style={styles.check}
              >
                <View style={[styles.box, confirmUnknown && styles.boxOn]} />
                <Text style={styles.checkText}>{P.confirm}</Text>
              </Pressable>
              <Button label={P.continue} variant="secondary" disabled={!confirmUnknown} onPress={() => pay(result.url!, result.host ?? P.unknownSite)} />
            </>
          ) : null}

          {result.verdict === 'dangerous' && !result.alternative ? (
            <Text style={[styles.reason, { color: tone.fg }]}>
              {P.dangerous(atStation.length ? atStation.join(', ') : null)}
            </Text>
          ) : null}
          {result.alternative === 'page' && officialLink ? <Button label={P.useOfficialPage(opName)} onPress={() => pay(officialLink, opName, 'operator-link')} /> : null}
          {result.alternative === 'reader' || (result.alternative === 'page' && !officialLink && readerConfirmed) ? (
            <Button label={P.useReader} variant={result.alternative === 'reader' ? 'primary' : 'secondary'} onPress={payAtReader} hint={t.recharger.hintReader} />
          ) : null}

          {result.kind === 'evse' && !mismatch ? (
            <Text style={[styles.reason, { color: tone.fg }]}>
              {P.evseNoLink}
            </Text>
          ) : null}
          {result.verdict !== 'official' && result.verdict !== 'known-operator' ? (
            <Pressable accessibilityRole="button" onPress={reportQr} style={styles.link} disabled={!!reported}>
              <Text style={[styles.linkText, { color: tone.fg }]}>{reported ?? P.reportFake}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{P.others}</Text>
        {readerLines.map((l) => (
          <Text key={l} style={styles.p}>
            {l}
          </Text>
        ))}
        {station?.tel ? (
          <Pressable accessibilityRole="link" style={styles.link} onPress={() => Linking.openURL(`tel:${station.tel!.replace(/[^+\d]/g, '')}`)}>
            <Text style={styles.linkText}>{P.call(opName)}</Text>
          </Pressable>
        ) : null}
      </View>
      {offline ? (
        <View role="alert" accessibilityLiveRegion="assertive">
          <Notice tone="error">{t.common.noNetwork}</Notice>
        </View>
      ) : null}
      {Platform.OS === 'web' ? <Text style={styles.small}>{P.webTab}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: MIN_TOUCH, paddingHorizontal: 14 },
  h1: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
  point: { fontFamily: fonts.display, fontSize: 16, color: colors.accentPressed },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkMuted },
  camWrap: { height: 340, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  cam: { flex: 1 },
  frame: { position: 'absolute', top: 60, left: '18%', right: '18%', bottom: 90, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 18 },
  stop: { position: 'absolute', left: 16, right: 16, bottom: 16, minHeight: 48 },
  manual: { gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 14,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  verify: { minHeight: 52, paddingHorizontal: 16, flexShrink: 0 },
  result: { borderRadius: radius.lg, padding: 16, gap: 8 },
  resultTitle: { fontFamily: fonts.bold, fontSize: 17 },
  domain: { fontFamily: fonts.semibold, fontSize: 15 },
  reason: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TOUCH },
  mismatch: { gap: 8, borderTopWidth: 1, borderTopColor: '#E5C9A8', paddingTop: 10 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.warnText, backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.warnText },
  checkText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  card: { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: 16, gap: 6 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
