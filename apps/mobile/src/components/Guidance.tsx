// Guidage plein écran : lisible d'un coup d'œil (manœuvre, distance, rue, voies, vitesse, limitation, arrivée).
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { navigationLinks } from '../lib/charge';
import { bigDist, etaClock, isOverSpeed, LOW_SOC, maneuverOf } from '../lib/guidance';
import { distText, durationText, INCIDENT_LABEL, postReport, type IncidentType } from '../lib/navigation';
import { etaMessage, shareEta } from '../lib/shareEta';
import type { TripApi } from '../lib/useTrip';
import { isMuted, onMutedChange, setMuted } from '../lib/voice';
import type { Station } from '../lib/stations';
import { colors, fonts, radius } from '../theme';
import { LaneArrow, ManeuverIcon, NavIcon } from './ManeuverIcon';
import { Button } from './ui';

const REPORTS: { type: IncidentType; label: string }[] = [
  { type: 'accident', label: 'Accident' },
  { type: 'bouchon', label: 'Bouchon' },
  { type: 'travaux', label: 'Travaux' },
  { type: 'obstacle', label: 'Obstacle' },
  { type: 'borne_hs', label: 'Borne hors service' },
];

const MANEUVER_A11Y: Record<string, string> = {
  roundabout: 'rond-point',
  'exit-right': 'sortie à droite',
  'exit-left': 'sortie à gauche',
  'keep-right': 'rester à droite',
  'keep-left': 'rester à gauche',
};

export function Guidance({ nav, onRecharge }: { nav: TripApi; onRecharge: (s: Station) => void }) {
  const insets = useSafeAreaInsets();
  const trip = nav.trip;
  const [muted, setMutedState] = useState(isMuted());
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => onMutedChange(setMutedState), []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);
  if (!trip?.route) return null;

  const next = trip.next;
  const m = next ? maneuverOf(next.step) : 'straight';
  const d = bigDist(next?.inM ?? 0);
  const street = next ? next.step.street ?? next.step.towards ?? next.step.instruction : 'Suivez l’itinéraire';
  const lanes = next && next.inM < 1500 ? next.step.lanes : undefined;
  const over = isOverSpeed(trip.speedKmh, trip.limitKmh);
  const remainingS = trip.remainingS || trip.route.durationS;
  const remainingM = trip.remainingM || trip.route.distanceM;
  // Avec une étape de recharge, la batterie utile est celle en arrivant à la borne.
  const soc = trip.via.length && typeof trip.viaSoc === 'number' ? trip.viaSoc : trip.battery?.[trip.route.id];
  const station = trip.arrivedAtVia?.station ?? (trip.arrived ? trip.dest.station : undefined);
  const exitTxt = next?.step.exit ? `, sortie ${next.step.exit}` : '';

  async function report(t: IncidentType) {
    setReporting(false);
    const p = nav.position;
    if (!p) return setNote('Position inconnue : signalement impossible.');
    try {
      await postReport(t, p);
      setNote(`${INCIDENT_LABEL[t]} signalé, merci.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Signalement impossible.');
    }
  }

  async function share() {
    const r = await shareEta(etaMessage(trip!.dest.name, etaClock(remainingS), Math.max(1, Math.round(remainingS / 60))));
    setNote(r === 'copied' ? 'Heure d’arrivée copiée : collez-la dans un message.' : r === 'shared' ? 'Heure d’arrivée partagée.' : 'Partage impossible sur cet appareil.');
  }

  const banner = trip.arrived || trip.arrivedAtVia ? null : (
    <View
      style={styles.banner}
      accessible
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={next ? `Dans ${distText(next.inM)}, ${MANEUVER_A11Y[m] ?? ''}${exitTxt}. ${next.step.instruction}` : 'Suivez l’itinéraire'}
    >
      <View style={styles.bannerRow}>
        <View testID="maneuver-icon" accessibilityLabel={`Manœuvre : ${m}${exitTxt}`}>
          <ManeuverIcon maneuver={m} exit={next?.step.exit} angle={next?.step.angle} size={84} />
        </View>
        <View style={{ flex: 1 }}>
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
        <View style={styles.lanes} accessibilityLabel={`Voies : prenez ${lanes.map((l, i) => (l.active ? i + 1 : null)).filter(Boolean).join(' ou ')} sur ${lanes.length}, en partant de la gauche`}>
          {lanes.map((l, i) => (
            <View key={i} style={[styles.lane, i > 0 && styles.laneSep]}>
              <LaneArrow dirs={l.directions} active={l.active} />
            </View>
          ))}
        </View>
      ) : null}
      {trip.then && trip.then.gapM < 300 && maneuverOf(trip.then.step) !== 'arrive' ? (
        <View style={styles.then}>
          <Text style={styles.thenText}>Puis</Text>
          <ManeuverIcon maneuver={maneuverOf(trip.then.step)} exit={trip.then.step.exit} angle={trip.then.step.angle} size={28} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        {banner}
        {trip.gps === 'lost' ? <Text style={[styles.pill, styles.pillWarn]}>Signal GPS perdu : le guidage reprendra dès que la position sera retrouvée.</Text> : null}
        {trip.gps === 'unavailable' ? (
          <View style={[styles.pill, styles.pillWarn, { gap: 8 }]}>
            <Text style={styles.pillText}>GPS indisponible : autorisez la localisation pour être guidé, ou continuez avec :</Text>
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
        {trip.rerouting ? <Text style={[styles.pill, styles.pillInfo]}>Recalcul de l’itinéraire…</Text> : null}
        {note ? <Text style={[styles.pill, styles.pillInfo]}>{note}</Text> : null}
      </View>

      {!trip.arrived && !trip.arrivedAtVia ? (
        <View style={[styles.side, { bottom: 150 + insets.bottom }]} pointerEvents="box-none">
          <View style={styles.speedBox} accessible accessibilityLabel={`Vitesse ${trip.speedKmh === null ? 'inconnue' : `${Math.round(trip.speedKmh)} kilomètres heure`}${trip.limitKmh ? `, limitée à ${trip.limitKmh}` : ''}${over ? ', dépassement' : ''}`}>
            {trip.limitKmh ? (
              <View style={styles.limit} testID="speed-limit">
                <Text style={styles.limitText}>{trip.limitKmh}</Text>
              </View>
            ) : null}
            <View style={[styles.speed, over && styles.speedOver]} testID="speed">
              <Text style={[styles.speedText, over && { color: '#FFFFFF' }]}>{trip.speedKmh === null ? '–' : Math.round(trip.speedKmh)}</Text>
              <Text style={[styles.speedUnit, over && { color: '#FFFFFF' }]}>km/h</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <RoundBtn label={muted ? 'Réactiver la voix' : 'Couper la voix'} pressed={muted} onPress={() => setMuted(!muted)}>
              <NavIcon name={muted ? 'voice-off' : 'voice-on'} size={26} color={muted ? colors.danger : colors.ink} />
            </RoundBtn>
            <RoundBtn label="Signaler" onPress={() => setReporting(true)}>
              <NavIcon name="report" size={26} color={colors.busy} />
            </RoundBtn>
            <RoundBtn label="Partager mon heure d’arrivée" onPress={share}>
              <NavIcon name="share" size={24} />
            </RoundBtn>
          </View>
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {trip.arrived || trip.arrivedAtVia ? (
          <View style={{ gap: 10 }} accessibilityLiveRegion="polite">
            <Text style={styles.kicker}>{trip.arrivedAtVia ? 'Étape atteinte' : 'Vous êtes arrivé'}</Text>
            <Text style={styles.arrTitle} numberOfLines={2} accessibilityRole="header">
              {(trip.arrivedAtVia ?? trip.dest).name}
            </Text>
            {station ? <Button label="Recharger ici" onPress={() => onRecharge(station)} hint="Ouvre le parcours de recharge et de paiement de cette borne" /> : null}
            {trip.arrivedAtVia ? <Button label="Reprendre le trajet" variant="secondary" onPress={nav.resumeAfterVia} /> : null}
            <Button label="Terminer" variant="ghost" onPress={nav.clear} />
          </View>
        ) : (
          <View style={styles.bottomRow}>
            <View style={{ flex: 1 }} accessible accessibilityLabel={`Arrivée prévue à ${etaClock(remainingS)}, dans ${durationText(remainingS)}, ${distText(remainingM)} restants`}>
              <Text style={styles.eta}>{etaClock(remainingS)}</Text>
              <Text style={styles.etaMeta}>
                {durationText(remainingS)} · {distText(remainingM)}
                {typeof soc === 'number' ? <Text style={{ color: soc < LOW_SOC ? colors.danger : colors.accentPressed }}> · batterie {Math.max(0, soc)} %</Text> : null}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Arrêter le guidage" onPress={nav.clear} style={styles.stop}>
              <NavIcon name="close" size={26} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
        <Text style={styles.small}>{trip.provider === 'tomtom' ? '© TomTom · trafic temps réel' : '© contributeurs OpenStreetMap, Valhalla'} · Bison Futé · zones de danger © OSM</Text>
      </View>

      {reporting ? (
        <View style={styles.scrim}>
          <View style={[styles.reportSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
            <Text style={styles.arrTitle} accessibilityRole="header">
              Signaler
            </Text>
            <Text style={styles.smallDark}>Un geste, anonyme, visible 1 h (24 h pour une borne). Seulement ce que vous voyez — le passager de préférence.</Text>
            <View style={styles.grid}>
              {REPORTS.map((x) => (
                <Button key={x.type} label={x.label} variant="ghost" style={styles.reportBtn} onPress={() => report(x.type)} />
              ))}
              <Button label="Annuler" variant="secondary" style={styles.reportBtn} onPress={() => setReporting(false)} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RoundBtn(props: { label: string; onPress: () => void; children: React.ReactNode; pressed?: boolean }) {
  return (
    <Pressable
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
  street: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 25, color: '#E8EEEC' },
  lanes: { flexDirection: 'row', alignSelf: 'center', backgroundColor: colors.nightCard, borderRadius: radius.md, paddingHorizontal: 6, paddingVertical: 4 },
  lane: { paddingHorizontal: 8, paddingVertical: 2 },
  laneSep: { borderLeftWidth: 2, borderLeftColor: 'rgba(255,255,255,0.25)', borderStyle: 'dashed' },
  then: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.nightCard, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  thenText: { fontFamily: fonts.semibold, fontSize: 15, color: '#E8EEEC' },
  pill: { alignSelf: 'stretch', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, fontFamily: fonts.bold, fontSize: 15, color: colors.ink, overflow: 'hidden', ...shadow },
  pillText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  pillWarn: { backgroundColor: '#FEF3E2', borderWidth: 2, borderColor: colors.busy },
  pillDanger: { backgroundColor: '#FDECEC', borderWidth: 2, borderColor: colors.danger },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reportBtn: { minHeight: 64, flexBasis: '47%', flexGrow: 1 },
});

