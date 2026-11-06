import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiConfig } from '../lib/api';
import { navigationLinks, startCharge } from '../lib/charge';
import { euros, km, kw, minutes, payLabel, plugLabel } from '../lib/format';
import { getAvailability, stationSummary, type AvailItem } from '../lib/availability';
import { getCommunity, type Community } from '../lib/community';
import { displayName, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { TariffLines } from './Pricing';
import { freeCredible } from '../lib/tariff';
import { allDown, nearestFree } from '../lib/nearestFree';
import { useLargeText } from '../lib/useLargeText';
import { Button, Notice, Stat, Tag } from './ui';
import { useT } from '../i18n';
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
  const live = useLive(s);
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
          <Notice tone="error">{t.station.allDown}</Notice>
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
      {live.known && !down ? (
        <Text style={[styles.live, { color: live.free ? colors.accentPressed : colors.busy }]}>
          {live.free ? t.station.liveFree(live.free, live.total) : t.station.liveNone}{t.station.liveSuffix}{live.down ? t.station.liveDown(live.down) : ''}
        </Text>
      ) : !live.known && live.reported ? (
        <Text style={[styles.live, styles.liveUnknown]} testID="station-unknown">{t.avail.inconnu}</Text>
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
        <Text style={styles.payText}>{t.station.payText(opName)}</Text>
        <Text style={styles.boxTitle}>{t.station.priceTitle}</Text>
        <TariffLines station={s} community={community} compact />
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

/** Disponibilité temps réel des points de la station (cache 60 s partagé : la fiche et l'action collante ne refont pas la requête). */
function useLive(s: Station) {
  const [avail, setAvail] = useState<Record<string, AvailItem>>({});
  useEffect(() => {
    let alive = true;
    setAvail({});
    getAvailability((s.pdc ?? []).map(([id]) => id)).then((a) => alive && setAvail(a));
    return () => {
      alive = false;
    };
  }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return stationSummary(s, avail);
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
