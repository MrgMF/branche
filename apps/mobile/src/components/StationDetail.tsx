import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiConfig } from '../lib/api';
import { navigationLinks, startCharge } from '../lib/charge';
import { euros, km, kw, minutes, payLabel, plugLabel } from '../lib/format';
import { availabilityDown, getAvailability, stationSummary, type AvailItem } from '../lib/availability';
import { getCommunity, lastPriceText, type Community } from '../lib/community';
import { loadWallet, type Wallet } from '../lib/accounts';
import { appLaunchOption, appOnly, badgeMentioned, badgeNames, confirmedChannels, payOptions, surelyPayable } from '../lib/methods';
import { AcceptedMethods } from './AcceptedMethods';
import { loadPortals, type AppOS, type Portals } from '../lib/portals';
import type { Operator } from '../lib/qr';
import { displayName, loadOperators, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { colors, fonts, mapColors, MIN_TOUCH, radius } from '../theme';
import { PriceTrapLines, TariffLines } from './Pricing';
import { freeCredible, stationTariff } from '../lib/tariff';
import { priceTraps, totalCost } from '../lib/estimate';
import { bestPoint } from '../lib/cheapest';
import { loadVehicle, type Vehicle } from '../lib/vehicle';
import { allDown, nearestFree } from '../lib/nearestFree';
import { useLargeText } from '../lib/useLargeText';
import { Button, Notice, Stat, Tag } from './ui';
import { tr, useT } from '../i18n';
import { dateNum } from '../i18n/format';

export function StationDetail(props: {
  station: Station;
  distance: number | null;
  api: ApiConfig | null;
  apiError: boolean;
  apiLoading: boolean;
  operatorName: string;
  onRoute: () => void;
  onClose: () => void;
  /** Ouvre une autre borne (borne libre la plus proche quand celle-ci est hors service). */
  onPick?: (s: Station) => void;
  /** Action principale rendue à part, collée en bas du panneau (texte agrandi) : voir `StationMainAction`. */
  stickyAction?: boolean;
}) {
  const t = useT();
  const { station: s, distance, api } = props;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payAtStation = s.pay.filter((p) => p !== 'badge').map((p) => payLabel(p));
  const reserved = s.acc === 'reserve';
  const opName = props.operatorName;
  const [community, setCommunity] = useState<Community | null>(null);
  // Registre, portails et badges : texte de paiement selon les méthodes réellement déclarées pour cette borne
  const [payCtx, setPayCtx] = useState<{ ops: Operator[]; portals: Portals; wallet: Wallet } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([loadOperators(), loadPortals(), loadWallet()])
      .then(([ops, portals, wallet]) => alive && setPayCtx({ ops, portals, wallet }))
      .catch(() => alive && setPayCtx({ ops: [], portals: {}, wallet: { accounts: [], badges: [] } }));
    return () => {
      alive = false;
    };
  }, []);
  const live = useLive(s);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  useEffect(() => {
    let alive = true;
    loadVehicle().then((v) => alive && setVehicle(v));
    return () => {
      alive = false;
    };
  }, []);
  // Pièges tarifaires pour MON véhicule (point compatible le plus puissant) ; pas encore branché : délai, pas d'heure.
  const tariff = stationTariff(s);
  const pt = bestPoint(s, vehicle);
  const fresh = vehicle && Date.now() - vehicle.socUpdatedAt < 3 * 3600_000 ? vehicle.socPercent : null;
  const traps = priceTraps(tariff, totalCost({ vehicle, socPercent: fresh, pointKw: pt.kw, plugs: pt.plugs, tariff }));
  // Source du prix affiché : base nationale (tarif publié) et/ou prix constaté par la communauté
  const irvePrice = tariff.kind === 'priced';
  const seen = !!lastPriceText(community);
  const near = distance != null && distance < 0.3;
  const tel = s.tel ? phone(s.tel) : null;
  const large = useLargeText();
  // Borne entièrement hors service (temps réel) : on oriente vers la borne libre la plus proche.
  const down = allDown(live);
  const [alt, setAlt] = useState<{ s: Station; d: number } | null | undefined>(undefined);
  useEffect(() => {
    setAlt(undefined);
    if (!down) return;
    let alive = true;
    nearestFree(s, store.stations(), s.id).then((r) => alive && setAlt(r));
    return () => {
      alive = false;
    };
  }, [down, s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setCommunity(null);
    getCommunity(s.id).then((c) => alive && setCommunity(c));
    return () => {
      alive = false;
    };
  }, [s.id]);

  async function charge() {
    setErr(null);
    setBusy(true);
    try {
      await startCharge(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.station.errStart);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.title} accessibilityRole="header">{displayName(s)}</Text>
          <Text style={styles.sub}>
            {[s.o, distance != null ? `${km(distance)} · ${minutes(distance)}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t.station.closeA11y} onPress={props.onClose} style={styles.close} hitSlop={8}>
          <Text style={styles.closeX}>×</Text>
        </Pressable>
      </View>

      <View style={[styles.stats, large && { flexDirection: 'column' }]}>
        <Stat wrap={large} label={t.station.maxPower} value={kw(s.kw)} />
        <Stat wrap={large} label={t.station.points} value={String(s.p)} />
        <Stat wrap={large} label={t.station.access} value={reserved ? t.station.reserved : t.station.open} />
      </View>

      {/* Action principale juste sous les chiffres clés : visible sans défiler, même en 320 px. */}
      {down ? (
        <View style={styles.cta} testID="station-down">
          {/* Hors service : même jeton neutre que la carte et la liste (statusDown), pas le rouge « danger » */}
          <View style={styles.down} accessibilityRole="alert">
            <Text style={styles.downText}>{t.station.allDown}</Text>
          </View>
          {alt ? (
            <Button
              label={t.station.nearestFree}
              hint={t.station.nearestFreeHint}
              onPress={() => props.onPick?.(alt.s)}
              style={{ marginTop: 8 }}
            />
          ) : alt === null ? (
            <Text style={[styles.small, { marginTop: 6 }]}>{t.station.noFreeNearby}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.cta}>
        {props.stickyAction ? null : <MainButton s={s} near={near} down={down} />}
        {!near ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              store.setCurrent(s);
              router.push({ pathname: '/recharger', params: { station: s.id } });
            }}
            style={styles.link}
          >
            <Text style={styles.linkText}>{t.station.alreadyThere}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Temps réel : rien pendant le chargement ou si la requête échoue ; « État inconnu » seulement si l'API le renvoie. */}
      {/* « Occupé/In use » : warnText (#7A3E06), contraste renforcé (>= 7:1) plutôt que busy (#B45309, ~4,58:1). */}
      {live.known && !down ? (
        <Text style={[styles.live, { color: live.free ? colors.accentPressed : colors.warnText }]}>
          {live.free ? t.station.liveFree(live.free, live.total) : t.station.liveNone}{t.station.liveSuffix}{live.down ? t.station.liveDown(live.down) : ''}
        </Text>
      ) : !live.known && live.reported ? (
        <Text style={[styles.live, styles.liveUnknown]} testID="station-unknown">{t.avail.inconnu}</Text>
      ) : live.offline ? (
        <Text style={styles.small} testID="station-avail-down">{t.avail.offline}</Text>
      ) : null}

      <View style={styles.tags}>
        {s.c.map((c) => (
          <Tag key={c}>{plugLabel(c)}</Tag>
        ))}
        {s.h ? <Tag>{s.h === '24/7' ? t.station.h24 : s.h.length > 32 ? t.station.restricted : s.h}</Tag> : null}
        {/* Gratuité affichée seulement si crédible (même règle que le tarif : sinon « à vérifier » dans le bloc prix). */}
        {s.free && freeCredible(s) ? <Tag>{t.station.free}</Tag> : null}
      </View>

      {reserved ? <Notice tone="demo">{t.station.reservedNotice}</Notice> : null}
      {s.a ? <Text style={styles.addr}>{s.a}</Text> : null}

      <View style={styles.payCard}>
        <Text style={styles.payTitle}>{t.station.payTitle}</Text>
        {payCtx ? <Text style={styles.payText} testID="station-pay-text">{payTextFor(s, opName, payCtx)}</Text> : null}
        {payCtx ? <StationAccepted s={s} ctx={payCtx} /> : null}
        <Text style={styles.boxTitle}>{t.station.priceTitle}</Text>
        <TariffLines station={s} community={community} compact />
        <PriceTrapLines traps={traps} avg={!vehicle} />
        {irvePrice || seen ? <Text style={styles.small} testID="price-direct">{t.price.direct(irvePrice && seen ? 'both' : irvePrice ? 'irve' : 'community')}</Text> : null}
        {payAtStation.length ? <Text style={styles.small}>{t.station.acceptedOnSite(payAtStation.join(' · '))}</Text> : null}
      </View>

      <Button label={t.station.route} variant="secondary" onPress={props.onRoute} hint={t.station.routeHint} />
      <View style={styles.navRow}>
        {navigationLinks(s).map((l) => (
          <Button key={l.label} label={l.label} variant="ghost" style={{ flex: 1, minHeight: 44 }} onPress={() => Linking.openURL(l.url)} />
        ))}
      </View>

      {err ? <Notice tone="error">{err}</Notice> : null}

      {tel ? (
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${tel.dial}`)} style={styles.link}>
          <Text style={styles.linkText}>{t.station.call(tel.text)}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.small}>{t.station.source(s.maj ? dateNum(s.maj) : null)}</Text>
    </View>
  );
}

/**
 * Texte du bloc paiement, comme « Recharger » : « paiement direct » seulement si une méthode déclarée le permet
 * (surelyPayable) ; sinon « Non confirmé ici » (seulement du spéculatif) ou « Pas de paiement possible » (appli seule).
 */
function payTextFor(s: Station, op: string, ctx: { ops: Operator[]; portals: Portals; wallet: Wallet }): string {
  const t = tr();
  const os: AppOS = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  const options = payOptions(s, null, ctx.ops, { portals: ctx.portals, wallet: ctx.wallet, os });
  if (surelyPayable(options)) return t.station.payText(op);
  // Réseau « appli seule » avec passerelle sourcée : Branché amène à l'appli officielle (il n'y paie pas).
  if (appLaunchOption(options)) return t.station.payApp(op);
  if (!appOnly(options)) return t.recharger.unconfirmedBody(op);
  const portal = s.ok ? ctx.portals[s.ok] : undefined;
  return t.recharger.blockedBody(op, badgeNames(portal?.roamingBadgesAccepted).join(', ') || null, badgeMentioned(s));
}

/** Moyens acceptés (payMethods sourcés) des seuls canaux déclarés pour cette borne : page de paiement, lecteur. */
function StationAccepted({ s, ctx }: { s: Station; ctx: { ops: Operator[]; portals: Portals; wallet: Wallet } }) {
  const portal = s.ok ? ctx.portals[s.ok] : undefined;
  if (!portal?.payMethods) return null;
  const ch = confirmedChannels(payOptions(s, null, ctx.ops, { portals: ctx.portals, wallet: ctx.wallet }));
  if (!ch.web && !ch.reader) return null;
  return (
    <View style={{ gap: 6 }}>
      {ch.web ? <AcceptedMethods portal={portal} channel="web" variant="sheet" wallet /> : null}
      {ch.reader ? <AcceptedMethods portal={portal} channel="reader" variant="sheet" /> : null}
    </View>
  );
}

/** Disponibilité temps réel des points de la station (cache 60 s partagé : la fiche et l'action collante ne refont pas la requête). */
function useLive(s: Station) {
  const [avail, setAvail] = useState<Record<string, AvailItem>>({});
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let alive = true;
    setAvail({});
    setOffline(false);
    getAvailability((s.pdc ?? []).map(([id]) => id)).then((a) => {
      if (!alive) return;
      setAvail(a);
      setOffline(availabilityDown());
    });
    return () => {
      alive = false;
    };
  }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...stationSummary(s, avail), offline };
}

function MainButton({ s, near, down }: { s: Station; near: boolean; down: boolean }) {
  const t = useT();
  return (
    <Button
      variant={down ? 'secondary' : 'primary'}
      label={near ? t.here.rechargeHere : t.station.prepare}
      onPress={() => {
        store.setCurrent(s);
        router.push({ pathname: '/recharger', params: near ? { station: s.id } : { station: s.id, prepare: '1' } });
      }}
      hint={near ? t.station.hintHere : t.station.hintPrepare}
    />
  );
}

/** « Recharger ici » / « Préparer la recharge » collé en bas du panneau (texte agrandi : toujours atteignable sans défiler). */
export function StationMainAction({ station, distance }: { station: Station; distance: number | null }) {
  const live = useLive(station);
  return (
    <View style={styles.sticky} testID="station-sticky-cta">
      <MainButton s={station} near={distance != null && distance < 0.3} down={allDown(live)} />
    </View>
  );
}

/**
 * Numéro lisible et numéro à composer : « tel:+33176401280 » → « +33 1 76 40 12 80 » ; « 0176401280 » → « 01 76 40 12 80 ».
 */
export function phone(raw: string): { text: string; dial: string } | null {
  const dial = raw.replace(/^\s*tel:/i, '').replace(/[^+\d]/g, '');
  if (dial.replace(/\D/g, '').length < 6) return null;
  const fr = /^(?:\+33|0033)(\d)(\d{8})$/.exec(dial);
  if (fr) return { text: `+33 ${fr[1]} ${fr[2].match(/\d{2}/g)!.join(' ')}`, dial: `+33${fr[1]}${fr[2]}` };
  if (/^0\d{9}$/.test(dial)) return { text: dial.match(/\d{2}/g)!.join(' '), dial };
  if (dial.startsWith('+')) return { text: `+${dial.slice(1).replace(/(\d{2})(?=\d)/g, '$1 ')}`.trim(), dial };
  return { text: dial.replace(/(\d{2})(?=\d)/g, '$1 '), dial };
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  closeX: { fontSize: 26, lineHeight: 28, color: colors.ink, fontFamily: fonts.medium },
  stats: { flexDirection: 'row', gap: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addr: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted },
  cta: { gap: 2 },
  payCard: { borderWidth: 2, borderColor: colors.accent, borderRadius: radius.lg, padding: 14, gap: 10 },
  live: { fontFamily: fonts.bold, fontSize: 14 },
  down: { borderRadius: radius.md, borderWidth: 1, borderColor: mapColors.statusDown, backgroundColor: colors.surfaceAlt, paddingVertical: 10, paddingHorizontal: 12 },
  downText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink },
  liveUnknown: { fontFamily: fonts.medium, color: colors.inkMuted },
  sticky: { paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  payTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  payText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  demoBox: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12, gap: 8 },
  demoBtn: { minHeight: 48 },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, gap: 2 },
  boxTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkMuted },
  boxText: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  navTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkMuted, marginBottom: -6 },
  navRow: { flexDirection: 'row', gap: 8 },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  inlineLink: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, lineHeight: 17 },
});
