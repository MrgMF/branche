// Aperçu des trajets (avant guidage) : trajets comparés, options, batterie à l'arrivée, bornes sur le trajet.
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { navigationLinks } from '../lib/charge';
import { kw } from '../lib/format';
import { deltaText, etaClock, LOW_SOC } from '../lib/guidance';
import { distText, durationText, INCIDENT_LABEL } from '../lib/navigation';
import { displayName } from '../lib/stations';
import type { TripApi } from '../lib/useTrip';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { NavIcon } from './ManeuverIcon';
import { Button, Chip, Notice } from './ui';

export function TripPanel({ nav }: { nav: TripApi }) {
  const trip = nav.trip;
  if (!trip) return null;
  const r = trip.route;
  const best = trip.routes[0];
  const soc = r && trip.battery ? trip.battery[r.id] : undefined;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Itinéraire</Text>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {trip.dest.name}
          </Text>
          {trip.dest.sub ? (
            <Text style={styles.muted} numberOfLines={1}>
              {trip.dest.sub}
            </Text>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer l’itinéraire" onPress={nav.clear} style={styles.close}>
          <NavIcon name="close" size={22} />
        </Pressable>
      </View>

      <View style={styles.row} accessibilityLabel="Options d’itinéraire">
        <Chip label="Éviter les péages" active={trip.options.avoidTolls} onPress={() => nav.setOption('avoidTolls', !trip.options.avoidTolls)} />
        <Chip label="Éviter les autoroutes" active={trip.options.avoidMotorways} onPress={() => nav.setOption('avoidMotorways', !trip.options.avoidMotorways)} />
      </View>

      {trip.loading ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>{trip.traffic || !trip.provider ? 'Calcul des trajets avec le trafic en temps réel…' : 'Calcul des trajets…'}</Text>
        </View>
      ) : null}
      {trip.error ? (
        <>
          <Notice tone="error">{trip.error}</Notice>
          <Text style={styles.muted}>Lancez le trajet avec :</Text>
          <View style={styles.row}>
            {navigationLinks(trip.dest).map((l) => (
              <Button key={l.label} label={l.label} style={{ flex: 1 }} onPress={() => Linking.openURL(l.url)} />
            ))}
          </View>
        </>
      ) : null}

      {r && best ? (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel="Trajets proposés" style={{ gap: 8 }}>
            {trip.routes.map((x, i) => {
              const on = i === trip.selected;
              const b = trip.battery?.[x.id];
              const label = `${durationText(x.durationS)}, ${i === 0 ? 'le plus rapide' : deltaText(x.durationS - best.durationS)}, ${distText(x.distanceM)}${x.hasTolls ? ', avec péage' : ''}`;
              return (
                <Pressable
                  key={x.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  accessibilityLabel={label}
                  onPress={() => nav.selectRoute(i)}
                  style={[styles.card, on && styles.cardOn]}
                >
                  <View style={[styles.bar, { backgroundColor: on ? '#1D4ED8' : '#8A9792' }]} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.dur, on && { color: '#1D4ED8' }]}>{durationText(x.durationS)}</Text>
                      <Text style={[styles.delta, i === 0 ? { color: colors.accentPressed } : null]}>{i === 0 ? 'Le plus rapide' : deltaText(x.durationS - best.durationS)}</Text>
                    </View>
                    <Text style={styles.meta}>
                      Arrivée {etaClock(x.durationS)} · {distText(x.distanceM)}
                    </Text>
                    <View style={styles.tags}>
                      {trip.traffic ? (
                        <Text style={[styles.tag, x.trafficDelayS > 120 ? styles.tagWarn : styles.tagOk]}>
                          {x.trafficDelayS > 60 ? `Trafic +${Math.round(x.trafficDelayS / 60)} min` : 'Trafic fluide'}
                        </Text>
                      ) : null}
                      {x.hasTolls ? <Text style={[styles.tag, styles.tagWarn]}>Péage</Text> : <Text style={styles.tag}>Sans péage</Text>}
                      {x.hasMotorways ? <Text style={styles.tag}>Autoroute</Text> : null}
                      {typeof b === 'number' ? <Text style={[styles.tag, b < LOW_SOC ? styles.tagDanger : styles.tagOk]}>Batterie {Math.max(0, b)} %</Text> : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {!trip.traffic ? <Text style={styles.small}>Trafic en temps réel indisponible : durées sans trafic.</Text> : null}

          {trip.via.map((v) => (
            <View key={v.id} style={styles.via}>
              <NavIcon name="bolt" size={20} color={colors.accentPressed} />
              <Text style={[styles.meta, { flex: 1 }]} numberOfLines={2}>
                Étape recharge : {v.name}
              </Text>
              <Button label="Retirer" variant="ghost" style={styles.smallBtn} onPress={nav.removeVia} />
            </View>
          ))}

          {typeof soc === 'number' ? (
            soc < LOW_SOC ? (
              <View style={{ gap: 8 }}>
                <Notice tone="error">
                  Batterie estimée à l’arrivée : {Math.max(0, soc)} % ({trip.vehicleName}). Prévoyez une recharge rapide sur le trajet.
                </Notice>
                {trip.chargers.length === 0 ? <Text style={styles.muted}>Aucune borne rapide compatible trouvée à moins de 2 km du trajet.</Text> : null}
                {trip.chargers.map((c) => (
                  <View key={c.station.id} style={styles.charger}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.incTitle} numberOfLines={1}>
                        {displayName(c.station)}
                      </Text>
                      <Text style={styles.muted} numberOfLines={2}>
                        {kw(c.station.kw)} · à {distText(c.alongM)} du départ · batterie en arrivant ≈ {c.socAt} %
                      </Text>
                    </View>
                    <Button label="Ajouter l’étape" variant="secondary" style={styles.smallBtn} onPress={() => nav.addVia(c.station)} />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.meta}>
                Batterie estimée à l’arrivée : {soc} % ({trip.vehicleName})
              </Text>
            )
          ) : null}

          <Text style={styles.section}>Sur le trajet</Text>
          {trip.feedOk === false ? <Notice>Perturbations Bison Futé momentanément indisponibles : seuls les signalements des utilisateurs sont affichés.</Notice> : null}
          {trip.incidents.length === 0 && trip.zones.length === 0 && trip.feedOk !== false ? <Text style={styles.muted}>Aucune perturbation signalée sur ce trajet.</Text> : null}
          {trip.incidents.slice(0, 4).map((i) => (
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

          <Button label="Démarrer" onPress={nav.start} disabled={trip.loading} hint="Lance le guidage vocal plein écran" />
          <View style={styles.row}>
            {navigationLinks(trip.dest).map((l) => (
              <Button key={l.label} label={l.label} variant="ghost" style={{ flex: 1, minHeight: 48 }} onPress={() => Linking.openURL(l.url)} />
            ))}
          </View>
          <Text style={styles.small}>
            {trip.provider === 'tomtom' ? 'Itinéraire et trafic © TomTom.' : 'Itinéraire © contributeurs OpenStreetMap, Valhalla.'} Perturbations : Bison Futé (DIR, Licence Ouverte 2.0)
            {trip.feedUpdatedAt ? `, à jour de ${new Date(trip.feedUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''} et communauté. Zones de danger © contributeurs OpenStreetMap.
            {trip.battery ? ' Batterie : estimation indicative (consommation moyenne du modèle, marge incluse).' : ''}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  card: { flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, paddingLeft: 10, minHeight: 72 },
  cardOn: { borderColor: '#1D4ED8', borderWidth: 2, backgroundColor: '#F3F6FE' },
  bar: { width: 5, borderRadius: 3 },
  dur: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  delta: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted, backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  tagWarn: { color: '#7A3E06', backgroundColor: colors.warnSoft },
  tagOk: { color: colors.accentPressed, backgroundColor: colors.accentSoft },
  tagDanger: { color: colors.danger, backgroundColor: '#FDECEC' },
  via: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 10 },
  charger: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 },
  smallBtn: { minHeight: MIN_TOUCH, paddingHorizontal: 12 },
  section: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkMuted, marginTop: 4 },
  inc: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  incTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
