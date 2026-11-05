import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { navigationLinks } from '../lib/charge';
import { distText, durationText, INCIDENT_LABEL, postReport, type IncidentType } from '../lib/navigation';
import { displayName } from '../lib/stations';
import type { Trip } from '../lib/useTrip';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { Button, Notice } from './ui';

const REPORTS: { type: IncidentType; label: string }[] = [
  { type: 'accident', label: 'Accident' },
  { type: 'bouchon', label: 'Bouchon' },
  { type: 'travaux', label: 'Travaux' },
  { type: 'obstacle', label: 'Obstacle' },
  { type: 'borne_hs', label: 'Borne hors service' },
];

const arrivalAt = (s: number) => new Date(Date.now() + s * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function TripPanel(props: {
  trip: Trip;
  user: { lat: number; lon: number } | null;
  onStart: () => void;
  onStop: () => void;
  onPay: () => void;
}) {
  const { trip } = props;
  const r = trip.route;
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState<string | null>(null);

  async function report(t: IncidentType) {
    if (!props.user) return;
    try {
      await postReport(t, props.user);
      setReported(`${INCIDENT_LABEL[t]} signalé, merci.`);
    } catch (e) {
      setReported(e instanceof Error ? e.message : 'Signalement impossible.');
    }
    setReporting(false);
  }

  const remainingRatio = r && trip.total ? Math.max(0, 1 - trip.along / trip.total) : 1;
  const remainingS = r ? r.durationS * remainingRatio : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{trip.guiding ? 'Guidage' : 'Itinéraire le plus rapide'}</Text>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {displayName(trip.dest)}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={trip.guiding ? 'Arrêter le guidage' : 'Fermer l’itinéraire'} onPress={props.onStop} style={styles.close}>
          <Text style={styles.closeX}>×</Text>
        </Pressable>
      </View>

      {trip.loading && !r ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Calcul du trajet le plus rapide avec le trafic…</Text>
        </View>
      ) : null}
      {trip.error ? <Notice tone="error">{trip.error}</Notice> : null}

      {r ? (
        <>
          {trip.guiding && trip.nextStep ? (
            <View style={styles.step} accessibilityLiveRegion="polite">
              <Text style={styles.stepDist}>{distText(trip.nextStep.inM)}</Text>
              <Text style={styles.stepText}>{trip.nextStep.instruction}</Text>
            </View>
          ) : null}
          {trip.alert ? (
            <View style={[styles.alert, trip.alert.tone === 'danger' ? styles.alertDanger : styles.alertInc]} accessibilityLiveRegion="assertive">
              <Text style={styles.alertText}>{trip.alert.text}</Text>
            </View>
          ) : null}

          <View style={styles.summary}>
            <Text style={styles.eta}>{durationText(remainingS)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.meta}>
                Arrivée {arrivalAt(remainingS)} · {distText(Math.max(0, (trip.total || r.distanceM) - trip.along))}
              </Text>
              <Text style={[styles.meta, { color: r.traffic ? (r.trafficDelayS > 120 ? colors.busy : colors.accentPressed) : colors.inkMuted }]}>
                {r.traffic
                  ? r.trafficDelayS > 60
                    ? `+${Math.round(r.trafficDelayS / 60)} min de trafic, déjà compté`
                    : 'Trafic fluide'
                  : 'Trafic en temps réel indisponible'}
              </Text>
            </View>
          </View>

          {trip.arrived ? (
            <>
              <Notice>Vous êtes arrivé.</Notice>
              <Button label="Payer la borne depuis Branché" onPress={props.onPay} />
            </>
          ) : null}

          {!trip.guiding ? (
            <>
              <Text style={styles.section}>Sur le trajet</Text>
              {trip.feedOk === false ? (
                <Notice>Perturbations Bison Futé momentanément indisponibles : seuls les signalements des utilisateurs sont affichés.</Notice>
              ) : null}
              {trip.incidents.length === 0 && trip.zones.length === 0 && trip.feedOk !== false ? (
                <Text style={styles.muted}>Aucune perturbation signalée sur ce trajet.</Text>
              ) : null}
              {trip.incidents.slice(0, 5).map((i) => (
                <View key={i.id} style={styles.inc}>
                  <View style={[styles.dot, { backgroundColor: i.type === 'accident' || i.type === 'fermeture' ? colors.danger : colors.busy }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.incTitle}>
                      {INCIDENT_LABEL[i.type] ?? i.title} · à {distText(i.alongM)}
                    </Text>
                    {i.description ? (
                      <Text style={styles.muted} numberOfLines={2}>
                        {i.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
              {trip.zones.length ? (
                <Text style={styles.muted}>
                  {trip.zones.length} zone{trip.zones.length > 1 ? 's' : ''} de danger sur le trajet (aide à la conduite).
                </Text>
              ) : null}
              <Button label="Démarrer" onPress={props.onStart} />
              <View style={styles.row}>
                {navigationLinks(trip.dest).map((l) => (
                  <Button key={l.label} label={l.label} variant="ghost" style={{ flex: 1, minHeight: 44 }} onPress={() => Linking.openURL(l.url)} />
                ))}
              </View>
            </>
          ) : (
            <>
              {reported ? <Notice>{reported}</Notice> : null}
              {reporting ? (
                <View style={styles.reports}>
                  <Text style={[styles.small, { width: '100%' }]}>Signalement anonyme, visible 1 h (24 h pour une borne). Seulement ce que vous avez constaté, et pas en conduisant.</Text>
                  {REPORTS.map((x) => (
                    <Button key={x.type} label={x.label} variant="ghost" style={styles.reportBtn} onPress={() => report(x.type)} />
                  ))}
                </View>
              ) : (
                <View style={styles.row}>
                  <Button label="Signaler" variant="secondary" style={{ flex: 1 }} onPress={() => setReporting(true)} />
                  <Button label="Arrêter" variant="ghost" style={{ flex: 1 }} onPress={props.onStop} />
                </View>
              )}
            </>
          )}
          <Text style={styles.small}>
            {r.provider === 'tomtom' ? 'Itinéraire et trafic © TomTom.' : 'Itinéraire © contributeurs OpenStreetMap, Valhalla.'} Perturbations : Bison Futé (DIR, Licence Ouverte 2.0){trip.feedUpdatedAt ? `, à jour de ${new Date(trip.feedUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''} et communauté. Zones de danger © contributeurs OpenStreetMap.
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  closeX: { fontSize: 26, lineHeight: 28, color: colors.ink, fontFamily: fonts.medium },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  step: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 14, gap: 2 },
  stepDist: { fontFamily: fonts.display, fontSize: 26, color: '#FFFFFF' },
  stepText: { fontFamily: fonts.semibold, fontSize: 16, color: '#E8EEEC' },
  alert: { borderRadius: radius.md, padding: 12 },
  alertDanger: { backgroundColor: '#FEF3E2', borderWidth: 2, borderColor: colors.busy },
  alertInc: { backgroundColor: '#FDECEC', borderWidth: 2, borderColor: colors.danger },
  alertText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  eta: { fontFamily: fonts.display, fontSize: 30, color: colors.accentPressed },
  meta: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  section: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkMuted, marginTop: 4 },
  inc: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  incTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  reports: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reportBtn: { minHeight: 48, flexGrow: 1 },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
