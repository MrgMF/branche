import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { lastPriceText, reliabilityText, type Community } from '../lib/community';
import type { ChargePoint } from '../lib/evse';
import { durationLabel, estimateCharge } from '../lib/estimate';
import { euros } from '../lib/format';
import type { Station } from '../lib/stations';
import { describeTariff, parseTariff } from '../lib/tariff';
import type { Vehicle } from '../lib/vehicle';
import { kwhText } from '../i18n/format';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { useT } from '../i18n';

/** Tarif publié (analysé) + fiabilité et prix constatés par la communauté. */
export function TariffLines({ station, community, compact }: { station: Station; community: Community | null; compact?: boolean }) {
  const T = useT();
  const t = parseTariff(station.prix, { free: station.free });
  const lines = describeTariff(t);
  const rel = reliabilityText(community);
  const last = lastPriceText(community);
  const rate = community?.successRate;
  return (
    <View style={styles.wrap}>
      {lines.length ? (
        lines.map((l) => (
          <Text key={l} style={[styles.line, compact && styles.lineCompact]}>
            {l}
          </Text>
        ))
      ) : (
        <Text style={styles.line}>
          {t.kind === 'link' ? T.pricing.link : T.pricing.unpublished}
          {t.notes.length ? ` ${t.notes.join(' ')}` : ''}
        </Text>
      )}
      {t.url ? (
        <Pressable accessibilityRole="link" accessibilityLabel={T.pricing.seeOperatorA11y} onPress={() => Linking.openURL(t.url!)} style={styles.link}>
          <Text style={styles.linkText}>{T.pricing.seeOperator}</Text>
        </Pressable>
      ) : null}
      {!compact && t.kind === 'priced' ? <Text style={styles.src}>{T.pricing.src(t.raw.length > 90 ? `${t.raw.slice(0, 90)}…` : t.raw)}</Text> : null}
      {rel ? (
        <View style={[styles.badge, { backgroundColor: rate != null && rate < 0.6 ? colors.warnSoft : colors.accentSoft }]} accessibilityRole="text">
          <Text style={[styles.badgeText, { color: rate != null && rate < 0.6 ? '#7A3E06' : colors.accentPressed }]}>{T.pricing.reliability(rel)}</Text>
        </View>
      ) : null}
      {last ? <Text style={styles.src}>{last}</Text> : null}
    </View>
  );
}

/** Résumé « prix avant de payer » : tarif publié + estimation pour le point (scan depuis l'accueil, avant « Payer »). */
export function PriceSummary({ station, point, vehicle, community }: { station: Station; point: ChargePoint; vehicle: Vehicle | null; community: Community | null }) {
  const T = useT();
  const R = T.recharger;
  const tariff = parseTariff(station.prix, { free: station.free });
  const fresh = vehicle && Date.now() - vehicle.socUpdatedAt < 3 * 3600_000 ? vehicle.socPercent : null;
  const est = estimateCharge({ vehicle, socPercent: fresh, pointKw: point.kw, plugs: point.plugs, tariff });
  const cost = est.cost != null ? `≈ ${euros(Math.round(est.cost * 100))}` : R.unknown;
  return (
    <View style={styles.summary} accessibilityRole="summary">
      <Text style={styles.summaryTitle} accessibilityRole="header">
        {R.priceBefore}
      </Text>
      <TariffLines station={station} community={community} compact />
      <Text style={styles.src}>{R.estimateFor(est.assumedVehicle ? R.avgVehicle55 : vehicle?.name ?? '', est.fromSoc, est.toSoc)}</Text>
      <Text style={styles.line}>
        {`${R.energy} ${kwhText(est.kWhBilled)} · ${R.duration} ≈ ${durationLabel(est.minutes)} · ${R.cost} ${cost}`}
      </Text>
      {est.unknownPrice ? <Text style={styles.src}>{R.unknownPriceNote.trim()}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 6, borderRadius: radius.md, padding: 12, backgroundColor: colors.surface },
  summaryTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  wrap: { gap: 6 },
  line: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.ink },
  lineCompact: { fontSize: 14, lineHeight: 20 },
  src: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  badge: { borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
});
