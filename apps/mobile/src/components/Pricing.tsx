import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lastPriceText, reliabilityText, type Community } from '../lib/community';
import type { ChargePoint } from '../lib/evse';
import { durationLabel, estimateCharge } from '../lib/estimate';
import { euros, withUnit } from '../lib/format';
import type { Operator } from '../lib/qr';
import { loadPortals, portalPaid } from '../lib/portals';
import { loadOperators, type Station } from '../lib/stations';
import { describeTariff, safeTariffUrl, stationTariff } from '../lib/tariff';
import type { Vehicle } from '../lib/vehicle';
import { eur, kwhText } from '../i18n/format';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { tr, useT } from '../i18n';

/**
 * Réseau payant notoire selon ses sources (portalPaid) pour l'opérateur de la borne : portails relus une fois (cache).
 * Gratuité déclarée non crédible → « Tarif non publié dans la base nationale » et coût « Inconnu ».
 */
export function usePaidNetwork(operatorKey: string | null | undefined): boolean {
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    let alive = true;
    setPaid(false);
    if (operatorKey) loadPortals().then((p) => alive && setPaid(portalPaid(p[operatorKey])));
    return () => {
      alive = false;
    };
  }, [operatorKey]);
  return paid;
}

/** Coût affiché : estimation, sinon « À confirmer » (gratuité douteuse) ou « Inconnu » (réseau payant, prix absent). */
export function costLabel(est: { cost: number | null; freeDoubtful: boolean }, paidNetwork: boolean, approx = '≈ '): string {
  const R = tr().recharger;
  if (est.cost != null) return `${approx}${euros(Math.round(est.cost * 100))}`;
  return est.freeDoubtful && !paidNetwork ? R.toConfirm : R.unknown;
}

/** Tarif publié (analysé) + fiabilité et prix constatés par la communauté. */
export function TariffLines({ station, community, compact, paidNetwork }: { station: Station; community: Community | null; compact?: boolean; paidNetwork?: boolean }) {
  const T = useT();
  const t = stationTariff(station);
  // Valeur fournie par l'écran (portails déjà chargés), sinon relue ici
  const paidHere = usePaidNetwork(paidNetwork === undefined ? station.ok : null);
  const lines = describeTariff(t, { paidNetwork: paidNetwork ?? paidHere });
  const rel = reliabilityText(community);
  const last = lastPriceText(community);
  const rate = community?.successRate;
  const [ops, setOps] = useState<Operator[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (t.url) loadOperators().then((o) => alive && setOps(o));
    return () => {
      alive = false;
    };
  }, [t.url]);
  // Vérifié une fois le registre des opérateurs chargé ; ouvert dans le navigateur intégré (pas l'app externe)
  const tariffUrl = ops ? safeTariffUrl(t.url, station.ok ?? null, ops) : null;
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
      {tariffUrl ? (
        <Pressable accessibilityRole="link" accessibilityLabel={T.pricing.seeOperatorA11y} onPress={() => void WebBrowser.openBrowserAsync(tariffUrl).catch(() => undefined)} style={styles.link}>
          <Text style={styles.linkText}>{T.pricing.seeOperator}</Text>
        </Pressable>
      ) : null}
      {!compact && t.kind === 'priced' ? <Text style={styles.src}>{T.pricing.src(t.raw.length > 90 ? `${t.raw.slice(0, 90)}…` : t.raw)}</Text> : null}
      {rel ? (
        <View style={[styles.badge, { backgroundColor: rate != null && rate < 0.6 ? colors.warnSoft : colors.accentSoft }]} accessibilityRole="text">
          <Text style={[styles.badgeText, { color: rate != null && rate < 0.6 ? colors.warnText : colors.accentPressed }]}>{T.pricing.reliability(rel)}</Text>
        </View>
      ) : null}
      {last ? <Text style={styles.src}>{last}</Text> : null}
    </View>
  );
}

/** Résumé « prix avant de payer » : tarif publié + estimation pour le point (scan depuis l'accueil, avant « Payer »). */
export function PriceSummary({
  station,
  point,
  vehicle,
  community,
  preauthMax,
}: {
  station: Station;
  point: ChargePoint;
  vehicle: Vehicle | null;
  community: Community | null;
  /** Montant pré-autorisé publié par l'opérateur (preauthMaxOf), sinon texte générique court. */
  preauthMax: number | null;
}) {
  const T = useT();
  const R = T.recharger;
  const tariff = stationTariff(station);
  const paidNetwork = usePaidNetwork(station.ok);
  const fresh = vehicle && Date.now() - vehicle.socUpdatedAt < 3 * 3600_000 ? vehicle.socPercent : null;
  const est = estimateCharge({ vehicle, socPercent: fresh, pointKw: point.kw, plugs: point.plugs, tariff });
  const cost = costLabel(est, paidNetwork);
  return (
    <View style={styles.summary} accessibilityRole="summary">
      <Text style={styles.summaryTitle} accessibilityRole="header">
        {R.priceBefore}
      </Text>
      <TariffLines station={station} community={community} compact paidNetwork={paidNetwork} />
      <Text style={styles.src}>{withUnit(R.estimateFor(est.assumedVehicle ? R.avgVehicle55 : vehicle?.name ?? '', est.fromSoc, est.toSoc))}</Text>
      <Text style={styles.line}>
        {withUnit(`${R.energy} ${kwhText(est.kWhBilled)} · ${R.duration} ≈ ${durationLabel(est.minutes)} · ${R.cost} ${cost}`)}
      </Text>
      {/* Tarif non publié : le conseil « vérifiez l'écran » est déjà affiché au-dessus */}
      {est.unknownPrice && !est.freeDoubtful && (describeTariff(tariff).length || tariff.kind === 'link') ? <Text style={styles.src}>{R.unknownPriceNote.trim()}</Text> : null}
      <Text style={styles.line}>{preauthMax != null ? `${R.preauth} · ${eur(preauthMax, 0)}` : R.preauthGeneric}</Text>
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
