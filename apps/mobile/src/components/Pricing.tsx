import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lastPriceText, reliabilityText, type Community } from '../lib/community';
import type { ChargePoint } from '../lib/evse';
import { bandCosts, durationLabel, estimateCharge, priceTraps, STAYS, stayMinutes, totalCost, type PriceTrap, type Stay, type TotalCost } from '../lib/estimate';
import { euros, NBSP, withUnit } from '../lib/format';
import type { Operator } from '../lib/qr';
import { loadPortals, portalPaid } from '../lib/portals';
import { loadOperators, type Station } from '../lib/stations';
import { bandLabel, describeTariff, safeTariffUrl, stationTariff, type Tariff } from '../lib/tariff';
import type { Vehicle } from '../lib/vehicle';
import { clock, eur, kwhText, perKwh } from '../i18n/format';
import { Chip } from './ui';
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
  const tariff = stationTariff(station, point.kw);
  const paidNetwork = usePaidNetwork(station.ok);
  const fresh = vehicle && Date.now() - vehicle.socUpdatedAt < 3 * 3600_000 ? vehicle.socPercent : null;
  const est = estimateCharge({ vehicle, socPercent: fresh, pointKw: point.kw, plugs: point.plugs, tariff });
  const cost = costLabel(est, paidNetwork);
  // Scan depuis l'accueil : on est à la borne, l'heure de débranchement part de maintenant.
  const total = totalCost({ vehicle, socPercent: fresh, pointKw: point.kw, plugs: point.plugs, tariff });
  return (
    <View style={styles.summary} accessibilityRole="summary">
      <Text style={styles.summaryTitle} accessibilityRole="header">
        {R.priceBefore}
      </Text>
      <TariffLines station={station} community={community} compact paidNetwork={paidNetwork} />
      <PriceTrapLines traps={priceTraps(tariff, total, Date.now())} avg={!vehicle} />
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

/** Une ligne par piège tarifaire, calculée pour MA recharge (rien sans tarif publié). */
export function trapText(t: PriceTrap, avg = false): string {
  const P = tr().price;
  if (t.kind === 'perMin') return withUnit(P.trapPerMin(perKwh(t.perKwh), avg));
  if (t.kind === 'session') return P.trapSession;
  return withUnit(t.at != null ? P.trapIdleAt(t.afterMin, clock(t.at)) : P.trapIdleIn(t.afterMin, durationLabel(t.inMin)));
}

/** `avg` : aucun véhicule renseigné (estimation pour un véhicule moyen, dite comme telle). */
export function PriceTrapLines({ traps, avg }: { traps: PriceTrap[]; avg?: boolean }) {
  const T = useT();
  if (!traps.length) return null;
  return (
    <View style={styles.traps} accessibilityLabel={T.price.trapsA11y} testID="price-traps">
      {traps.map((x) => (
        <View key={x.kind} style={styles.trap} testID={`trap-${x.kind}`}>
          <View style={styles.trapDot} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={styles.trapText}>{trapText(x, avg)}</Text>
        </View>
      ))}
    </View>
  );
}

/** « Coût total ≈ 14,20 € · 0,42 €/kWh effectif » (ou « Inconnu », jamais 0 inventé). */
export function totalText(c: TotalCost, paidNetwork: boolean, freeDoubtful: boolean): string {
  const P = tr().price;
  if (c.total == null) return `${P.total}${NBSP}: ${freeDoubtful && !paidNetwork ? tr().recharger.toConfirm : tr().recharger.unknown}`;
  const amount = euros(Math.round(c.total * 100));
  return withUnit(c.effectivePerKwh != null ? `${P.total} ${P.item(amount, perKwh(c.effectivePerKwh))}` : `${P.total} ≈ ${amount}`);
}

/** Postes non nuls : « Dont énergie 10,00 € · temps 1,40 € · forfait 1,00 € ». */
export function breakdownText(c: TotalCost): string | null {
  const P = tr().price;
  const parts: [string, number | null][] = [[P.partEnergy, c.energy], [P.partTime, c.time], [P.partSession, c.session], [P.partIdle, c.idle]];
  const shown = parts.filter(([, v]) => v != null && v > 0).map(([k, v]) => `${k} ${euros(Math.round(v! * 100))}`);
  return shown.length > 1 ? withUnit(P.breakdown(shown.join(' · '))) : null;
}

/** « Selon l'heure de début : 06:00–18:00 ≈ 12,13 € · 18:00–06:00 ≈ 15,00 € » (null sans plages analysées). */
export function bandsText(i: Parameters<typeof bandCosts>[0]): string | null {
  const P = tr().price;
  const list = bandCosts(i);
  if (list.length < 2 || list.every((x) => x.cost == null)) return null;
  const parts = list.map((x) => `${x.band ? bandLabel(x.band) : P.bandOther} ${x.cost != null ? `≈ ${euros(Math.round(x.cost * 100))}` : tr().recharger.unknown}`);
  return withUnit(P.bands(parts.join(' · ')));
}

/**
 * Coût total réel de MA recharge selon la durée de stationnement (« Je reste ~1 h / 2 h / la nuit ») et pièges tarifaires.
 * `plugAt` : heure de branchement (sur place : maintenant ; préparation : null, l'alerte d'occupation donne un délai).
 */
export function MyChargeCost({ tariff, input, plugAt, paidNetwork }: {
  tariff: Tariff;
  input: Omit<Parameters<typeof totalCost>[0], 'tariff' | 'stayMin'>;
  plugAt: number | null;
  paidNetwork: boolean;
}) {
  const T = useT();
  const P = T.price;
  const [stay, setStay] = useState<Stay>('charge');
  const c = totalCost({ ...input, tariff, stayMin: stayMinutes(stay) });
  const traps = priceTraps(tariff, c, plugAt);
  const detail = breakdownText(c);
  const bands = bandsText({ ...input, tariff });
  return (
    <View style={styles.wrap} testID="my-charge-cost">
      <PriceTrapLines traps={traps} avg={!input.vehicle} />
      <Text style={styles.estLabel} accessibilityRole="header">{P.stayTitle}</Text>
      <View style={styles.stays}>
        {STAYS.map((k) => (
          <Chip key={k} label={withUnit(P.stay[k])} a11y={P.stayA11y(P.stay[k])} active={stay === k} onPress={() => setStay(k)} />
        ))}
      </View>
      <Text style={styles.total} testID="total-cost">{totalText(c, paidNetwork, !!tariff.freeDoubtful)}</Text>
      {detail ? <Text style={styles.src}>{detail}</Text> : null}
      {c.cutShort ? <Text style={styles.src}>{P.cutShort}</Text> : null}
      {bands ? <Text style={styles.src} testID="band-costs">{bands}</Text> : null}
      {c.bandMode === 'overlap' ? <Text style={styles.src}>{P.bandOverlap}</Text> : c.bandMode === 'fallback' ? <Text style={styles.src}>{P.bandFallback}</Text> : null}
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
  traps: { gap: 6 },
  trap: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.warnSoft },
  trapDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.busy },
  trapText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.warnText },
  estLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkMuted },
  stays: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  total: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink },
});
