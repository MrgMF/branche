import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { lastPriceText, reliabilityText, type Community } from '../lib/community';
import type { Station } from '../lib/stations';
import { describeTariff, parseTariff } from '../lib/tariff';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

/** Tarif publié (analysé) + fiabilité et prix constatés par la communauté. */
export function TariffLines({ station, community, compact }: { station: Station; community: Community | null; compact?: boolean }) {
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
          {t.kind === 'link' ? 'Tarif publié sur le site de l’opérateur.' : 'Tarif non publié dans la base nationale : vérifiez l’écran de la borne avant de valider.'}
          {t.notes.length ? ` ${t.notes.join(' ')}` : ''}
        </Text>
      )}
      {t.url ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Voir les tarifs sur le site de l’opérateur" onPress={() => Linking.openURL(t.url!)} style={styles.link}>
          <Text style={styles.linkText}>Voir les tarifs de l’opérateur</Text>
        </Pressable>
      ) : null}
      {!compact && t.kind === 'priced' ? <Text style={styles.src}>Tarif déclaré par l’opérateur (base nationale IRVE), analysé automatiquement : « {t.raw.length > 90 ? `${t.raw.slice(0, 90)}…` : t.raw} »</Text> : null}
      {rel ? (
        <View style={[styles.badge, { backgroundColor: rate != null && rate < 0.6 ? colors.warnSoft : colors.accentSoft }]} accessibilityRole="text">
          <Text style={[styles.badgeText, { color: rate != null && rate < 0.6 ? '#7A3E06' : colors.accentPressed }]}>Fiabilité : {rel}</Text>
        </View>
      ) : null}
      {last ? <Text style={styles.src}>{last}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  line: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.ink },
  lineCompact: { fontSize: 14, lineHeight: 20 },
  src: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  badge: { borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
});
