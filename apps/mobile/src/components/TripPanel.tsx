// Aperçu des trajets (avant guidage) : trajets comparés, options, batterie à l'arrivée, bornes sur le trajet.
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { navigationLinks } from '../lib/charge';
import { kw } from '../lib/format';
import { deltaText, etaClock, LOW_SOC } from '../lib/guidance';
import { distText, durationText, incidentLabel } from '../lib/navigation';
import { useT } from '../i18n';
import { clock } from '../i18n/format';
import { displayName } from '../lib/stations';
import type { TripApi } from '../lib/useTrip';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { NavIcon } from './ManeuverIcon';
import { Button, Chip, Notice } from './ui';

export function TripPanel({ nav }: { nav: TripApi }) {
  const t = useT();
  const trip = nav.trip;
  if (!trip) return null;
  const r = trip.route;
  const best = trip.routes[0];
  const soc = r && trip.battery ? trip.battery[r.id] : undefined;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{t.trip.kicker}</Text>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {trip.dest.name}
          </Text>
          {trip.dest.sub ? (
            <Text style={styles.muted} numberOfLines={1}>
              {trip.dest.sub}
            </Text>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t.trip.closeA11y} onPress={nav.clear} style={styles.close}>
          <NavIcon name="close" size={22} />
        </Pressable>
      </View>

      <View style={styles.row} accessibilityLabel={t.trip.options}>
        <Chip label={t.trip.avoidTolls} active={trip.options.avoidTolls} onPress={() => nav.setOption('avoidTolls', !trip.options.avoidTolls)} />
        <Chip label={t.trip.avoidMotorways} active={trip.options.avoidMotorways} onPress={() => nav.setOption('avoidMotorways', !trip.options.avoidMotorways)} />
      </View>

      {trip.loading ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>{trip.traffic || !trip.provider ? t.trip.computingTraffic : t.trip.computing}</Text>
        </View>
      ) : null}
      {trip.error ? (
        <>
          <View accessibilityLiveRegion="polite" role="alert">
            <Notice tone="error">{trip.error}</Notice>
          </View>
          <Button label={t.mapCtl.retry} variant="secondary" onPress={nav.retry} loading={trip.loading} />
          <Text style={styles.muted}>{t.trip.launchWith}</Text>
          <View style={styles.row}>
            {navigationLinks(trip.dest).map((l) => (
              <Button key={l.label} label={l.label} style={{ flex: 1 }} onPress={() => Linking.openURL(l.url)} />
            ))}
          </View>
        </>
      ) : null}

      {r && best ? (
        <>
          <View accessibilityRole="radiogroup" accessibilityLabel={t.trip.routes} style={{ gap: 8 }}>
            {trip.routes.map((x, i) => {
              const on = i === trip.selected;
              const b = trip.battery?.[x.id];
              const label = t.trip.routeA11y(durationText(x.durationS), i === 0 ? t.trip.fastest : deltaText(x.durationS - best.durationS), distText(x.distanceM), x.hasTolls);
              return (
                <Pressable
                  key={x.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  aria-checked={on}
                  accessibilityLabel={label}
                  onPress={() => nav.selectRoute(i)}
                  style={[styles.card, on && styles.cardOn]}
                >
                  <View style={[styles.bar, { backgroundColor: on ? colors.accent : colors.switchOff }]} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.dur, on && { color: colors.accentPressed }]}>{durationText(x.durationS)}</Text>
                      <Text style={[styles.delta, i === 0 ? { color: colors.accentPressed } : null]}>{i === 0 ? t.trip.fastest : deltaText(x.durationS - best.durationS)}</Text>
                    </View>
                    <Text style={styles.meta}>
                      {t.trip.arrival(etaClock(x.durationS))} · {distText(x.distanceM)}
                    </Text>
                    <View style={styles.tags}>
                      {trip.traffic ? (
                        <Text style={[styles.tag, x.trafficDelayS > 120 ? styles.tagWarn : styles.tagOk]}>
                          {x.trafficDelayS > 60 ? t.trip.trafficPlus(Math.round(x.trafficDelayS / 60)) : t.trip.trafficOk}
                        </Text>
                      ) : null}
                      {x.hasTolls ? <Text style={[styles.tag, styles.tagWarn]}>{t.trip.toll}</Text> : <Text style={styles.tag}>{t.trip.noToll}</Text>}
                      {x.hasMotorways ? <Text style={styles.tag}>{t.trip.motorway}</Text> : null}
                      {typeof b === 'number' ? <Text style={[styles.tag, b < LOW_SOC ? styles.tagDanger : styles.tagOk]}>{t.trip.battery(Math.max(0, b))}</Text> : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {!trip.traffic ? <Text style={[styles.small, trip.client && styles.staticNote]}>{trip.client ? t.navx.noTrafficStatic : t.trip.noTraffic}</Text> : null}

          {trip.via.map((v) => (
            <View key={v.id} style={styles.via}>
              <NavIcon name="bolt" size={20} color={colors.accentPressed} />
              <Text style={[styles.meta, { flex: 1 }]} numberOfLines={2}>
                {t.trip.via(v.name)}
              </Text>
              <Button label={t.trip.remove} variant="ghost" style={styles.smallBtn} onPress={nav.removeVia} />
            </View>
          ))}

          {trip.via.length && typeof trip.viaSoc === 'number' ? (
            <Text style={styles.meta}>
              {t.trip.viaSoc(Math.max(0, trip.viaSoc), trip.vehicleName ?? '')}
            </Text>
          ) : typeof soc === 'number' ? (
            soc < LOW_SOC ? (
              <View style={{ gap: 8 }}>
                <Notice tone="error">
                  {t.trip.lowSoc(Math.max(0, soc), trip.vehicleName ?? '')}
                </Notice>
                {trip.chargers.length === 0 ? <Text style={styles.muted}>{t.trip.noChargers}</Text> : null}
                {trip.chargers.map((c) => (
                  <View key={c.station.id} style={styles.charger}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.incTitle} numberOfLines={1}>
                        {displayName(c.station)}
                      </Text>
                      <Text style={styles.muted} numberOfLines={2}>
                        {t.trip.chargerMeta(kw(c.station.kw), distText(c.alongM), c.socAt)}
                      </Text>
                    </View>
                    <Button label={t.trip.addVia} variant="secondary" style={styles.smallBtn} onPress={() => nav.addVia(c.station)} />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.meta}>
                {t.trip.socAtArrival(soc, trip.vehicleName ?? '')}
              </Text>
            )
          ) : null}

          <Text style={styles.section}>{t.trip.onRoute}</Text>
          {trip.feedOk === false ? trip.client ? <Text style={styles.muted}>{t.navx.noFeedStatic}</Text> : <Notice>{t.trip.feedDown}</Notice> : null}
          {trip.incidents.length === 0 && trip.zones.length === 0 && trip.feedOk !== false ? <Text style={styles.muted}>{t.trip.noIncidents}</Text> : null}
          {trip.incidents.slice(0, 4).map((i) => (
            <View key={i.id} style={styles.inc}>
              <View style={[styles.dot, { backgroundColor: i.type === 'accident' || i.type === 'fermeture' ? colors.danger : colors.busy }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.incTitle}>
                  {incidentLabel(i.type) ?? i.title} · {t.trip.at(distText(i.alongM))}
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
              {t.trip.zones(trip.zones.length)}
            </Text>
          ) : null}

          <View style={styles.row}>
            {navigationLinks(trip.dest).map((l) => (
              <Button key={l.label} label={l.label} variant="ghost" style={{ flex: 1, minHeight: 48 }} onPress={() => Linking.openURL(l.url)} />
            ))}
          </View>
          <Text style={styles.small}>
            {trip.client ? t.navx.attrStatic : trip.provider === 'tomtom' ? t.trip.attrTomtom : t.trip.attrOsm}
            {trip.client ? '' : t.trip.attrFeed(trip.feedUpdatedAt ? clock(Date.parse(trip.feedUpdatedAt)) : null)}
            {trip.battery ? t.trip.attrBattery : ''}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * Pied de la feuille d'itinéraire, hors du défilement : « Démarrer » reste visible quelle que soit la hauteur
 * d'écran (320 × 640 compris), avec la durée du trajet choisi.
 */
export function TripFooter({ nav }: { nav: TripApi }) {
  const t = useT();
  const trip = nav.trip;
  if (!trip || trip.guiding || !trip.route) return null;
  const r = trip.route;
  return (
    <View style={styles.footer} testID="trip-footer">
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.footDur} numberOfLines={1}>
          {durationText(r.durationS)}
        </Text>
        <Text style={styles.small} numberOfLines={1}>
          {t.trip.arrival(etaClock(r.durationS))} · {distText(r.distanceM)}
        </Text>
      </View>
      <Button label={t.trip.start} onPress={nav.start} disabled={trip.loading} hint={t.trip.startHint} style={{ flex: 1, minWidth: 140 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 },
  footDur: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  staticNote: { color: colors.ink, fontFamily: fonts.semibold },
  wrap: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  card: { flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, paddingLeft: 10, minHeight: 72 },
  // Trajet sélectionné : accent de la marque (le bleu reste réservé à la position et au tracé sur la carte).
  cardOn: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft },
  bar: { width: 5, borderRadius: 3 },
  dur: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  delta: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  meta: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted, backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  tagWarn: { color: colors.warnText, backgroundColor: colors.warnSoft },
  tagOk: { color: colors.accentPressed, backgroundColor: colors.accentSoft },
  tagDanger: { color: colors.danger, backgroundColor: colors.dangerSoft },
  via: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 10 },
  charger: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10 },
  smallBtn: { minHeight: MIN_TOUCH, paddingHorizontal: 12 },
  section: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkMuted, marginTop: 4 },
  inc: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  incTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
