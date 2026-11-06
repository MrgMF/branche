// Guidage plein écran : lisible d'un coup d'œil (manœuvre, distance, rue, voies, vitesse, limitation, arrivée).
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { AccessibilityInfo, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type HostInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { navigationLinks } from '../lib/charge';
import { kw } from '../lib/format';
import { navName } from '../lib/stations';
import { bigDist, etaClock, guidanceSide, instructionOf, isOverSpeed, LOW_SOC, maneuverOf, SOC_CHOICES } from '../lib/guidance';
import { useT } from '../i18n';
import { speedUnit, speedValue } from '../i18n/format';
import { distText, durationText, incidentLabel, postReport, type IncidentType } from '../lib/navigation';
import { etaMessage, shareEta } from '../lib/shareEta';
import type { TripApi } from '../lib/useTrip';
import { isMuted, onMutedChange, setMuted } from '../lib/voice';
import type { Station } from '../lib/stations';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { LaneArrow, ManeuverIcon, NavIcon } from './ManeuverIcon';
import { Button } from './ui';

const REPORTS: IncidentType[] = ['accident', 'bouchon', 'travaux', 'obstacle', 'borne_hs'];

export { guidanceSide } from '../lib/guidance';

export function Guidance({ nav, onRecharge }: { nav: TripApi; onRecharge: (s: Station) => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const trip = nav.trip;
  const [muted, setMutedState] = useState(isMuted());
  const [reporting, setReportingState] = useState(false);
  const reportBtn = useRef<HostInstance>(null);
  // Fermeture de la feuille « Signaler » : le focus revient au bouton d'origine (clavier, lecteur d'écran).
  const setReporting = useCallback((open: boolean) => {
    setReportingState(open);
    if (open) return;
    setTimeout(() => {
      const el = reportBtn.current;
      if (!el) return;
      if (Platform.OS === 'web') (el as unknown as { focus?: () => void }).focus?.();
      else AccessibilityInfo.sendAccessibilityEvent(el, 'focus');
    }, 50);
  }, []);
  // Web : Échap = Annuler.
  useEffect(() => {
    if (!reporting || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReporting(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reporting, setReporting]);
  const [note, setNote] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const { width, height } = useWindowDimensions();
  const side = guidanceSide(width, height);
  // Grille équilibrée : 6 boutons (5 types + Annuler) en 3 × 2 sur grand écran, 2 × 3 sinon.
  const reportCols = width >= 600 ? 3 : 2;
  useEffect(() => onMutedChange(setMutedState), []);
  // Décompte de la proposition de trajet plus rapide (rafraîchi chaque seconde).
  const offerAt = trip?.offer?.deadline;
  useEffect(() => {
    if (!offerAt) return;
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [offerAt]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);
  if (!trip?.route) return null;

  const next = trip.next;
  const m = next ? maneuverOf(next.step) : 'straight';
  const d = bigDist(next?.inM ?? 0);
  // Sortie / bifurcation : la direction des panneaux en ligne principale ; arrivée : le nom de la destination.
  const signpost = m.startsWith('exit-') || m.startsWith('keep-') || m === 'ramp';
  const street = !next
    ? t.guidance.follow
    : m === 'arrive'
      ? trip.dest.name
      : m === 'waypoint' && trip.via[0]
        ? trip.via[0].name
      : signpost
        ? next.step.towards ?? next.step.street ?? instructionOf(next.step)
        : next.step.street ?? next.step.towards ?? instructionOf(next.step);
  const exitBadge = next && signpost && next.step.exitNumber ? t.navx.exitBadge(next.step.exitNumber) : null;
  const offer = trip.offer;
  const offerLeft = offer ? Math.max(0, Math.ceil((offer.deadline - Date.now()) / 1000)) : 0;
  const lowCharger = trip.lowSoc !== null && !trip.via.length ? trip.chargers.find((c) => c.alongM > trip.along + 300) ?? null : null;
  const lanes = next && next.inM < 1500 ? next.step.lanes : undefined;
  const over = isOverSpeed(trip.speedKmh, trip.limitKmh);
  const remainingS = trip.remainingS || trip.route.durationS;
  const remainingM = trip.remainingM || trip.route.distanceM;
  // Avec une étape de recharge, la batterie utile est celle en arrivant à la borne.
  const soc = trip.via.length && typeof trip.viaSoc === 'number' ? trip.viaSoc : trip.battery?.[trip.route.id];
  const station = trip.arrivedAtVia?.station ?? (trip.arrived ? trip.dest.station : undefined);
  const exitTxt = next?.step.exit ? t.guidance.exit(next.step.exit) : '';
  const what = t.guidance.maneuver[m] ?? '';
  // Site statique (itinéraire calculé par l'app) : pas d'API, donc pas de signalement.
  const canReport = !trip.client;
  // Étape atteinte avec un véhicule : batterie après la recharge (un tap), ou estimation courante gardée.
  const askSoc = !!trip.arrivedAtVia && !!trip.vehicleName;
  const socEst = typeof trip.socNow === 'number' ? trip.socNow : null;

  async function report(type: IncidentType) {
    setReporting(false);
    const p = nav.position;
    if (!p) return setNote(t.guidance.noPos);
    try {
      await postReport(type, p);
      setNote(t.guidance.reported(incidentLabel(type) ?? type));
    } catch (e) {
      setNote(e instanceof Error ? e.message : t.guidance.reportFailed);
    }
  }

  async function share() {
    const r = await shareEta(etaMessage(trip!.dest.name, etaClock(remainingS), Math.max(1, Math.round(remainingS / 60))));
    setNote(r === 'copied' ? t.guidance.shareCopied : r === 'shared' ? t.guidance.shareDone : t.guidance.shareFailed);
  }

  const banner = trip.arrived || trip.arrivedAtVia ? null : trip.offRoute ? (
    <View style={styles.banner} accessible accessibilityRole="summary" accessibilityLiveRegion="polite" accessibilityLabel={t.navx.offRoute} testID="off-route">
      <View style={styles.bannerRow}>
        <Text style={styles.offRoute}>{t.navx.offRoute}</Text>
      </View>
    </View>
  ) : (
    <View
      style={styles.banner}
      accessible
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={next ? t.guidance.bannerA11y(distText(next.inM), what, exitTxt, m === 'arrive' ? `${instructionOf(next.step)} : ${trip.dest.name}` : instructionOf(next.step)) : t.guidance.follow}
    >
      <View style={styles.bannerRow}>
        <View testID="maneuver-icon" accessibilityLabel={t.guidance.maneuverA11y(what, exitTxt)}>
          <ManeuverIcon maneuver={m} exit={next?.step.exit} angle={next?.step.angle} size={84} />
        </View>
        <View style={{ flex: 1 }}>
          {exitBadge ? (
            <Text style={styles.exitBadge} testID="exit-badge">
              {exitBadge}
            </Text>
          ) : null}
          <Text style={styles.dist}>
            {d.value}
            <Text style={styles.unit}> {d.unit}</Text>
          </Text>
          <Text style={styles.street} numberOfLines={2}>
            {street}
          </Text>
        </View>
      </View>
      {lanes?.length ? (
        <View style={styles.lanes} accessibilityLabel={t.guidance.lanes(lanes.map((l, i) => (l.active ? i + 1 : null)).filter(Boolean).join(t.guidance.or), lanes.length)}>
          {lanes.map((l, i) => (
            <View key={i} style={[styles.lane, i > 0 && styles.laneSep]}>
              <LaneArrow dirs={l.directions} active={l.active} />
            </View>
          ))}
        </View>
      ) : null}
      {trip.then && trip.then.gapM < 300 && maneuverOf(trip.then.step) !== 'arrive' ? (
        <View style={styles.then}>
          <Text style={styles.thenText}>{t.guidance.then}</Text>
          <ManeuverIcon maneuver={maneuverOf(trip.then.step)} exit={trip.then.step.exit} angle={trip.then.step.angle} size={28} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { paddingTop: insets.top + 8 }, side ? { right: undefined, width: side, paddingLeft: insets.left + 10 } : null]} pointerEvents="box-none">
        {banner}
        {offer ? (
          <View style={styles.offer} accessibilityLiveRegion="assertive" testID="faster-offer">
            <Text style={styles.offerTitle} accessibilityRole="header">
              {t.navx.offerTitle(Math.max(1, Math.round(offer.gainS / 60)))}
            </Text>
            <Text style={styles.offerMeta}>{t.navx.offerCountdown(offerLeft, offer.def === 'take')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label={t.navx.offerTake} variant={offer.def === 'take' ? 'primary' : 'secondary'} style={{ flex: 1, minHeight: 52 }} onPress={() => void nav.takeOffer()} />
              <Button label={t.navx.offerKeep} variant={offer.def === 'keep' ? 'primary' : 'secondary'} style={{ flex: 1, minHeight: 52 }} onPress={nav.keepOffer} />
            </View>
          </View>
        ) : null}
        {trip.lowSoc !== null && !trip.via.length && !trip.arrived ? (
          <View style={[styles.offer, styles.lowSoc]} accessibilityLiveRegion="polite" testID="low-soc">
            <Text style={styles.offerTitle}>{t.navx.lowSocTitle(Math.max(0, trip.lowSoc))}</Text>
            <Text style={styles.offerMeta} numberOfLines={2}>
              {lowCharger ? t.navx.lowSocCharger(navName(lowCharger.station), kw(lowCharger.station.kw), distText(lowCharger.alongM - trip.along)) : trip.chargerSearching ? t.navx.lowSocSearching : t.trip.noChargers}
            </Text>
            {lowCharger ? <Button label={t.trip.addVia} style={{ minHeight: 52 }} onPress={() => nav.addVia(lowCharger.station)} /> : null}
          </View>
        ) : null}
        {trip.gps === 'lost' ? (
          <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={[styles.pill, styles.pillWarn]}>
            {t.guidance.gpsLost}
          </Text>
        ) : null}
        {trip.gps === 'unavailable' ? (
          <View style={[styles.pill, styles.pillWarn, { gap: 8 }]}>
            <Text style={styles.pillText}>{t.guidance.gpsUnavailable}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {navigationLinks(trip.dest).map((l) => (
                <Button key={l.label} label={l.label} variant="light" style={{ flex: 1, minHeight: 48 }} onPress={() => Linking.openURL(l.url)} />
              ))}
            </View>
          </View>
        ) : null}
        {trip.alert ? (
          <Text accessibilityLiveRegion="assertive" style={[styles.pill, trip.alert.tone === 'danger' ? styles.pillWarn : styles.pillDanger]}>
            {trip.alert.text}
          </Text>
        ) : null}
        {trip.toast ? (
          <Text accessibilityLiveRegion="polite" style={[styles.pill, trip.toast.tone === 'success' ? styles.pillOk : trip.toast.tone === 'warn' ? styles.pillWarn : styles.pillInfo]}>
            {trip.toast.text}
          </Text>
        ) : null}
        {trip.rerouting && !trip.offRoute ? <Text style={[styles.pill, styles.pillInfo]}>{t.guidance.rerouting}</Text> : null}
        {note ? <Text style={[styles.pill, styles.pillInfo]}>{note}</Text> : null}
      </View>

      {!trip.arrived && !trip.arrivedAtVia ? (
        <View style={[styles.side, { bottom: 150 + insets.bottom }, side ? { left: side + 12, bottom: 12 + insets.bottom } : null]} pointerEvents="box-none">
          <View style={styles.speedBox} accessible accessibilityLabel={t.guidance.speedA11y(trip.speedKmh === null ? null : `${speedValue(trip.speedKmh)} ${speedUnit()}`, trip.limitKmh ? `${speedValue(trip.limitKmh)} ${speedUnit()}` : null, over)}>
            {trip.limitKmh ? (
              <View style={styles.limit} testID="speed-limit">
                <Text style={styles.limitText}>{speedValue(trip.limitKmh)}</Text>
              </View>
            ) : null}
            <View style={[styles.speed, over && styles.speedOver]} testID="speed">
              <Text style={[styles.speedText, over && { color: '#FFFFFF' }]}>{trip.speedKmh === null ? '–' : speedValue(trip.speedKmh)}</Text>
              <Text style={[styles.speedUnit, over && { color: '#FFFFFF' }]}>{speedUnit()}</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <RoundBtn label={muted ? t.guidance.voiceOn : t.guidance.voiceOff} pressed={muted} onPress={() => setMuted(!muted)}>
              <NavIcon name={muted ? 'voice-off' : 'voice-on'} size={26} color={muted ? colors.danger : colors.ink} />
            </RoundBtn>
            {canReport ? (
              <RoundBtn label={t.guidance.report} onPress={() => setReporting(true)} btnRef={reportBtn}>
                <NavIcon name="report" size={26} color={colors.busy} />
              </RoundBtn>
            ) : null}
            <RoundBtn label={t.guidance.share} onPress={share}>
              <NavIcon name="share" size={24} />
            </RoundBtn>
          </View>
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }, side ? { right: undefined, width: side, borderTopRightRadius: radius.xl, borderTopLeftRadius: 0 } : null]}>
        {trip.arrived || trip.arrivedAtVia ? (
          <View style={{ gap: 10 }} accessibilityLiveRegion="polite">
            <Text style={styles.kicker}>{trip.arrivedAtVia ? t.guidance.viaReached : t.guidance.arrived}</Text>
            <Text style={styles.arrTitle} numberOfLines={2} accessibilityRole="header">
              {(trip.arrivedAtVia ?? trip.dest).name}
            </Text>
            {station ? <Button label={t.here.rechargeHere} onPress={() => onRecharge(station)} hint={t.guidance.rechargeHint} /> : null}
            {askSoc ? (
              <View style={{ gap: 6 }} testID="soc-ask">
                <Text style={styles.smallDark} accessibilityRole="header">
                  {t.navx.socAsk}
                </Text>
                <View style={styles.socRow}>
                  {SOC_CHOICES.map((p) => (
                    <Pressable
                      key={p}
                      accessibilityRole="button"
                      accessibilityLabel={t.navx.socChoiceA11y(p)}
                      onPress={() => nav.resumeAfterVia(p)}
                      style={({ pressed }) => [styles.socChip, pressed && { backgroundColor: colors.surfaceAlt }]}
                    >
                      <Text style={styles.socChipText}>{p} %</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {trip.arrivedAtVia ? (
              <Button label={askSoc && socEst !== null ? t.navx.socKeep(socEst) : t.guidance.resume} variant="secondary" onPress={() => nav.resumeAfterVia()} />
            ) : null}
            <Button label={t.guidance.finish} variant="ghost" onPress={nav.clear} />
          </View>
        ) : (
          <View style={styles.bottomRow}>
            <View style={{ flex: 1 }} accessible accessibilityLabel={t.guidance.etaA11y(etaClock(remainingS), durationText(remainingS), distText(remainingM))}>
              <Text style={styles.eta}>{etaClock(remainingS)}</Text>
              <Text style={styles.etaMeta}>
                {durationText(remainingS)} · {distText(remainingM)}
                {typeof soc === 'number' ? <Text style={{ color: soc < LOW_SOC ? colors.danger : colors.accentPressed }}>{t.guidance.battery(Math.max(0, soc))}</Text> : null}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t.guidance.stop} onPress={nav.clear} style={styles.stop}>
              <NavIcon name="close" size={26} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
        <Text style={styles.small}>
          {!trip.traffic ? `${t.navx.noTrafficShort} · ` : ''}
          {trip.client ? t.navx.attrStatic : trip.provider === 'tomtom' ? t.guidance.attrTomtom : t.guidance.attrOsm}
          {trip.client ? '' : t.guidance.attrTail}
        </Text>
      </View>

      {trip.bgAsk ? (
        <View style={styles.scrim}>
          <View style={[styles.reportSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal testID="bg-consent">
            <Text style={styles.arrTitle} accessibilityRole="header">
              {t.navx.bgTitle}
            </Text>
            <Text style={styles.smallDark}>{t.navx.bgBody}</Text>
            {Platform.OS === 'android' ? <Text style={styles.smallDark}>{t.navx.bgSystem}</Text> : null}
            <Button label={t.navx.bgAllow} onPress={() => void nav.allowBackground()} />
            <Button label={t.navx.bgLater} variant="ghost" onPress={nav.refuseBackground} />
          </View>
        </View>
      ) : null}

      {reporting && canReport ? (
        <View style={styles.scrim}>
          <View style={[styles.reportSheet, styles.reportCenter, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal aria-modal testID="report-sheet">
            <Text style={styles.arrTitle} accessibilityRole="header">
              {t.guidance.report}
            </Text>
            <Text style={styles.smallDark}>{t.guidance.reportNote}</Text>
            <View style={styles.grid}>
              {REPORTS.map((x) => (
                <ReportBtn key={x} label={incidentLabel(x) ?? x} cols={reportCols} onPress={() => report(x)} />
              ))}
              <ReportBtn label={t.common.cancel} cols={reportCols} cancel onPress={() => setReporting(false)} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ReportBtn(props: { label: string; onPress: () => void; cols: number; cancel?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.reportBtn,
        { width: props.cols === 3 ? '31.5%' : '48%' },
        props.cancel ? styles.reportCancel : null,
        pressed && { backgroundColor: colors.border },
      ]}
    >
      <Text style={styles.reportLabel} numberOfLines={2}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function RoundBtn(props: { label: string; onPress: () => void; children: React.ReactNode; pressed?: boolean; btnRef?: Ref<HostInstance> }) {
  return (
    <Pressable
      ref={props.btnRef}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={props.pressed === undefined ? undefined : { selected: props.pressed }}
      onPress={props.onPress}
      style={({ pressed }) => [styles.round, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      {props.children}
    </Pressable>
  );
}

const shadow = { shadowColor: '#0F1A17', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 };

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 8 },
  banner: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: 14, gap: 10, ...shadow },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dist: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50, color: '#FFFFFF' },
  unit: { fontFamily: fonts.displayMedium, fontSize: 24, color: '#FFFFFF' },
  street: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 25, color: colors.nightText },
  // Panneau de sortie (vert autoroute français : texte blanc, contraste AA).
  exitBadge: { alignSelf: 'flex-start', backgroundColor: colors.signExit, color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 16, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4, overflow: 'hidden' },
  offer: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, gap: 8, borderWidth: 2, borderColor: colors.accent, ...shadow },
  lowSoc: { borderColor: colors.danger },
  offerTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  offerMeta: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkMuted },
  lanes: { flexDirection: 'row', alignSelf: 'center', backgroundColor: colors.nightCard, borderRadius: radius.md, paddingHorizontal: 6, paddingVertical: 4 },
  lane: { paddingHorizontal: 8, paddingVertical: 2 },
  laneSep: { borderLeftWidth: 2, borderLeftColor: 'rgba(255,255,255,0.25)', borderStyle: 'dashed' },
  then: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.nightCard, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  thenText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.nightText },
  pill: { alignSelf: 'stretch', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, fontFamily: fonts.bold, fontSize: 15, color: colors.ink, overflow: 'hidden', ...shadow },
  pillText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  pillWarn: { backgroundColor: colors.warnSoft, borderWidth: 2, borderColor: colors.busy },
  pillDanger: { backgroundColor: colors.dangerSoft, borderWidth: 2, borderColor: colors.danger },
  pillOk: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.accent },
  pillInfo: { backgroundColor: colors.surface },
  side: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  speedBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  speed: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow },
  speedOver: { backgroundColor: colors.danger },
  speedText: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: colors.ink },
  speedUnit: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted },
  limit: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF', borderWidth: 7, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', ...shadow },
  limitText: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  actions: { gap: 10 },
  round: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 18, paddingTop: 14, gap: 6, ...shadow },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eta: { fontFamily: fonts.display, fontSize: 32, color: colors.ink },
  etaMeta: { fontFamily: fonts.semibold, fontSize: 16, color: colors.inkMuted },
  stop: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  arrTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted },
  smallDark: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,26,23,0.45)', justifyContent: 'flex-end' },
  reportSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18, gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  offRoute: { flex: 1, fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: '#FFFFFF', paddingVertical: 10 },
  // 6 choix en 2 rangées de 3 (grille équilibrée).
  socRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  socChip: { width: '31.5%', minWidth: MIN_TOUCH, minHeight: 48, paddingHorizontal: 8, borderRadius: radius.md, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  socChipText: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  reportBtn: { minHeight: 64, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  reportCancel: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.inputBorder },
  reportLabel: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, color: colors.ink, textAlign: 'center' },
  // Feuille centrée et de largeur bornée sur grand écran.
  reportCenter: { alignSelf: 'center', width: '100%', maxWidth: 640 },
});

