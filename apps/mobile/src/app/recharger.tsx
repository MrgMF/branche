// Parcours « Recharger ici » : point de charge → prix avant de payer → méthode recommandée et mode d'emploi.
// Une seule action principale par étape. Ouvert par la détection de proximité, le scan d'un QR code, la fiche
// station, l'arrivée du guidage, ou un lien profond branche://recharger?evse=FR*ABC*E123 (web : /recharger?evse=).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CopyId } from '../components/CopyId';
import { TariffLines } from '../components/Pricing';
import { Button, Notice, Tag } from '../components/ui';
import { getCommunity, preauthText, reliabilityText, type Community } from '../lib/community';
import { operatorLabel, payOptions, runPlan, type PayOption } from '../lib/connectors';
import { availLabel, getAvailability, type AvailItem } from '../lib/availability';
import { clearPrepared, loadPrepared, savePrepared, type Prepared } from '../lib/prepared';
import { durationLabel, estimateCharge, isDc } from '../lib/estimate';
import { findStation, pointById, pointsOf, type ChargePoint } from '../lib/evse';
import { euros, km, kw, plugLabel } from '../lib/format';
import type { MethodId } from '../lib/history';
import type { Operator } from '../lib/qr';
import { displayName, distanceKm, loadOperators, nearest, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { parseTariff } from '../lib/tariff';
import { compatible, loadVehicle, saveVehicle, type Vehicle } from '../lib/vehicle';
import { loadWallet, type Wallet } from '../lib/accounts';
import { appOnly } from '../lib/methods';
import { loadPortals, type Portals } from '../lib/portals';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { ScreenHeader } from '../components/Screen';
import { useLocale, useT } from '../i18n';
import { kwhText } from '../i18n/format';

const SKIP_KEY = 'branche.vehicle.skipped.v1';
const SOC_FRESH_MS = 3 * 3600_000;

export default function Recharger() {
  const t = useT();
  const R = t.recharger;
  const { lang } = useLocale();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ evse?: string; station?: string; step?: string; method?: string; noLink?: string; prepare?: string }>();
  const [station, setStation] = useState<Station | null | undefined>(undefined);
  const [pointId, setPointId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(params.step === 'point');
  const [ops, setOps] = useState<Operator[]>([]);
  const [community, setCommunity] = useState<Community | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null | undefined>(undefined);
  const [skipped, setSkipped] = useState(true);
  const [soc, setSoc] = useState<number | null>(null);
  const [method, setMethod] = useState<MethodId | null>((params.method as MethodId) || null);
  const [showIncompatible, setShowIncompatible] = useState(false);
  const [avail, setAvail] = useState<Record<string, AvailItem>>({});
  const [portals, setPortals] = useState<Portals>({});
  const [wallet, setWallet] = useState<Wallet>({ accounts: [], badges: [] });
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [savedPrep, setSavedPrep] = useState(false);
  const preparing = params.prepare === '1';

  // Station et point depuis le lien, la sélection courante ou l'index EVSE
  useEffect(() => {
    let alive = true;
    (async () => {
      const id = params.evse || params.station || store.current()?.id || '';
      const cur = store.current();
      let found: { station: Station; pdcId: string | null } | null = null;
      if (cur && (!id || cur.id === id)) found = { station: cur, pdcId: null };
      else if (id) found = await findStation(id, [...store.stations(), ...(cur ? [cur] : [])]);
      if (!alive) return;
      setStation(found?.station ?? null);
      if (found) {
        store.setCurrent(found.station);
        // Recharge préparée pour cette borne : point et méthode repris d'office
        const prep = await loadPrepared();
        const mine = prep?.station.id === found.station.id ? prep : null;
        if (mine && alive) {
          setPrepared(mine);
          setMethod((m) => m ?? mine.plan.method);
        }
        const pdc = params.evse ? found.pdcId : store.plan()?.stationId === found.station.id ? store.plan()?.pdcId ?? null : mine?.plan.pdcId ?? null;
        if (pdc && pointById(found.station, pdc)) {
          setPointId(pointById(found.station, pdc)!.id);
          setChoosing(params.step === 'point');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.evse, params.station]); // eslint-disable-line react-hooks/exhaustive-deps

  // Au retour de « Mon véhicule » ou « Mes badges » : profil relu
  useFocusEffect(
    useCallback(() => {
      loadWallet().then(setWallet);
      loadVehicle().then((v) => {
        setVehicle(v);
        if (v && Date.now() - v.socUpdatedAt < SOC_FRESH_MS) setSoc(v.socPercent);
      });
    }, []),
  );

  useEffect(() => {
    loadOperators().then(setOps);
    loadPortals().then(setPortals);
    AsyncStorage.getItem(SKIP_KEY)
      .then((x) => setSkipped(x === '1'))
      .catch(() => setSkipped(false));
  }, []);

  useEffect(() => {
    if (!station) return;
    getCommunity(station.id).then(setCommunity);
    getAvailability(pointsOf(station).map((p) => p.id)).then(setAvail);
  }, [station]);

  const points = useMemo(() => (station ? pointsOf(station) : []), [station]);
  const usable = points.filter((p) => compatible(p.plugs, vehicle));
  const incompatible = points.filter((p) => !compatible(p.plugs, vehicle));
  // Un seul point possible : choisi d'office (un geste de moins)
  const autoPoint = usable.length === 1 ? usable[0] : null;
  const point: ChargePoint | null = (pointId && station ? pointById(station, pointId) : null) ?? (choosing ? null : autoPoint);
  const step: 'point' | 'pay' = !point || choosing ? 'point' : 'pay';

  const tariff = useMemo(() => parseTariff(station?.prix, { free: station?.free }), [station]);
  const est = useMemo(
    () => (point ? estimateCharge({ vehicle: vehicle ?? null, socPercent: soc, pointKw: point.kw, plugs: point.plugs, tariff }) : null),
    [point, vehicle, soc, tariff],
  );
  const options = useMemo(() => (station ? payOptions(station, point, ops, { portals, wallet }) : []), [station, point, ops, portals, wallet, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const portal = station?.ok ? portals[station.ok] : undefined;
  const accountConnected = !!station?.ok && wallet.accounts.some((a) => a.operatorKey === station.ok);
  // Rien de payable ici depuis Branché : alternative la plus proche qui l'est
  const blocked = appOnly(options);
  const alternative = useMemo(() => {
    if (!blocked || !station) return null;
    const near = nearest(store.stations().filter((x) => x.id !== station.id && x.acc !== 'reserve' && compatible(x.c, vehicle)), station, 30);
    return near.find(({ s: x }) => !appOnly(payOptions(x, null, ops, { portals, wallet }).filter((o) => o.id !== 'scan' || x.pay.some((p) => p === 'qr_dynamique' || p === 'site_web' || p === 'acte')))) ?? null;
  }, [blocked, station, ops, portals, wallet, vehicle]);
  // QR code sans lien de paiement (identifiant seul) : on recommande la méthode suivante
  const fallback = params.noLink ? options.find((o) => o.available && o.id !== 'scan') : undefined;
  const chosen: PayOption | undefined = options.find((o) => o.id === method && o.available) ?? fallback ?? options[0];
  const opName = operatorLabel(station ?? null, ops);

  function back() {
    if (step === 'pay' && points.length > 1 && !params.evse) {
      setPointId(null);
      setChoosing(true);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function pick(p: ChargePoint) {
    setPointId(p.id);
    setChoosing(false);
  }

  function changeSoc(delta: number) {
    const next = Math.max(0, Math.min(95, (soc ?? 20) + delta));
    setSoc(next);
    if (vehicle) {
      const v = { ...vehicle, socPercent: next, socUpdatedAt: Date.now() };
      setVehicle(v);
      saveVehicle(v);
    }
  }

  function skipVehicle() {
    setSkipped(true);
    AsyncStorage.setItem(SKIP_KEY, '1').catch(() => undefined);
  }

  function go(o: PayOption) {
    if (!station || !point || !o.available) return;
    store.setCurrent(station);
    store.setPlan({
      stationId: station.id,
      pdcId: point.id,
      pointKw: point.kw,
      plugs: point.plugs,
      method: o.id,
      socPercent: soc,
      vehicle: vehicle ? { name: vehicle.name, batteryKWh: vehicle.batteryKWh, maxDcKW: vehicle.maxDcKW, maxAcKW: vehicle.maxAcKW } : null,
      tariffRaw: station.prix,
      free: station.free,
    });
    const plan = store.plan()!;
    if (preparing) {
      savePrepared({ station, plan, operatorName: opName, url: o.url, estimatedCost: est?.cost ?? null, createdAt: Date.now() });
      setSavedPrep(true);
      return;
    }
    if (prepared) clearPrepared();
    runPlan(station, plan, opName, o.url);
  }

  if (station === undefined) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.muted}>{R.searching}</Text>
      </View>
    );
  }
  if (!station) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <View style={styles.body}>
          <ScreenHeader title={R.notFound} />
        </View>
      <View style={[styles.center, { flex: 1 }]}>
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          {params.evse ? R.notFoundEvse(params.evse) : R.pickOnMap}
        </Text>
        <Button label={R.scanQr} onPress={() => router.replace('/payer')} style={{ alignSelf: 'stretch' }} />
        <Button label={t.common.backToMap} variant="ghost" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </View>
      </View>
    );
  }

  // Proposé au 1er passage (au choix du point, ou directement s'il n'y a qu'un point) ; jamais bloquant
  if (savedPrep) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
        <View style={styles.body}>
          <ScreenHeader title={displayName(station)} kicker={R.prepKicker.replace(/[·\s]+$/, '')} />
        </View>
      <View style={[styles.center, { flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' }]}>
        <Text style={styles.h1} accessibilityRole="header">{R.ready}</Text>
        <Text style={[styles.p, { textAlign: 'center' }]}>
          {R.readyBody(displayName(station), chosen?.id === 'reader')}
        </Text>
        <Notice>{R.readyNotice(opName)}</Notice>
        <Button label={t.common.backToMap} onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </View>
      </View>
    );
  }

  const vehiclePrompt = vehicle === null && !skipped && (step === 'point' || usable.length < 2);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
      <ScreenHeader
        onBack={back}
        kicker={`${preparing ? R.prepKicker : ''}${step === 'point' ? R.step1 : points.length > 1 || autoPoint === null ? R.step2 : t.titles.recharger}`}
        title={displayName(station)}
        sub={opName}
      />
      {step === 'point' && reliabilityText(community) ? <Text style={styles.small}>{t.pricing.reliability(reliabilityText(community)!)}</Text> : null}

      {vehiclePrompt ? (
        <View style={styles.vehicleCard}>
          <Text style={styles.cardTitle}>{R.vehicleQ}</Text>
          <Text style={styles.p}>{R.vehicleWhy}</Text>
          <View style={styles.row}>
            <Button label={t.common.choose} variant="secondary" onPress={() => router.push('/vehicule')} style={styles.half} />
            <Button label={t.common.skip} variant="ghost" onPress={skipVehicle} style={styles.half} />
          </View>
        </View>
      ) : null}

      {step === 'point' ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.h2} accessibilityRole="header">{R.pickPoint}</Text>
          <Text style={styles.p}>{R.pickPointHelp}</Text>
          {usable.map((p) => (
            <PointRow key={p.id} p={p} onPress={() => pick(p)} selected={p.id === pointId} status={avail[p.id]} />
          ))}
          {!usable.length ? <Notice tone="demo">{R.noCompatible(vehicle?.name ?? R.yourVehicle)}</Notice> : null}
          {incompatible.length ? (
            <>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showIncompatible }} onPress={() => setShowIncompatible((x) => !x)} style={styles.link}>
                <Text style={styles.linkText}>
                  {R.toggleIncompatible(showIncompatible, incompatible.length, vehicle?.name ?? R.yourVehicle)}
                </Text>
              </Pressable>
              {showIncompatible ? incompatible.map((p) => <PointRow key={p.id} p={p} disabled />) : null}
            </>
          ) : null}
          {station.p > points.length ? <Text style={styles.small}>{R.otherPoints(station.p - points.length)}</Text> : null}
        </View>
      ) : point && est ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={R.pointA11y(point.short, kw(point.kw))}
            onPress={() => {
              setChoosing(true);
            }}
            style={styles.pointChip}
            disabled={points.length < 2}
          >
            <Text style={styles.pointShort}>…{point.short}</Text>
            <Text style={[styles.p, { flex: 1 }]} numberOfLines={2}>
              {kw(point.kw)} · {point.plugs.map((p) => plugLabel(p)).join(', ')}
            </Text>
            {points.length > 1 ? <Text style={styles.linkText}>{t.common.change}</Text> : null}
          </Pressable>

          {/* Prix avant de payer */}
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">{R.priceBefore}</Text>
            <TariffLines station={station} community={community} />
            <View style={styles.estimate} accessibilityRole="summary">
              <Text style={styles.estLabel}>
                {R.estimateFor(est.assumedVehicle ? R.avgVehicle55 : vehicle?.name ?? '', est.fromSoc, est.toSoc)}
              </Text>
              <View style={styles.estRow}>
                <Big label={R.energy} value={kwhText(est.kWhBilled)} />
                <Big label={R.duration} value={`≈ ${durationLabel(est.minutes)}`} />
                <Big label={R.cost} value={est.cost != null ? `≈ ${euros(Math.round(est.cost * 100))}` : R.unknown} />
              </View>
              <Text style={styles.small}>
                {R.powerNote(kw(est.powerKw), isDc(point.kw, point.plugs), kw(point.kw), est.assumedVehicle)}
                {est.partial ? R.partial : ''}
                {est.unknownPrice ? R.unknownPriceNote : ''}
              </Text>
              <View style={styles.socRow}>
                <Text style={[styles.p, { flex: 1 }]}>{R.socNow(soc == null)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={R.socMinus} onPress={() => changeSoc(-5)} style={styles.step}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.socValue} accessibilityLabel={R.socA11y(soc ?? 20)}>
                  {soc ?? 20} %
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={R.socPlus} onPress={() => changeSoc(5)} style={styles.step}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
              {vehicle ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/vehicule')} style={styles.link}>
                  <Text style={styles.linkText}>{R.changeVehicle}</Text>
                </Pressable>
              ) : skipped ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/vehicule')} style={styles.link}>
                  <Text style={styles.linkText}>{R.setVehicle}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.preauth}>
              <Text style={styles.estLabel}>{R.preauth}</Text>
              <Text style={styles.small}>
                {R.preauthBody(opName)}
              </Text>
              {preauthText(community) ? <Text style={[styles.small, { color: colors.ink }]}>{preauthText(community)}</Text> : null}
            </View>
            {tariff.idle ? (
              <Notice tone="demo">
                {R.idle(tariff.idle.afterMin)}
              </Notice>
            ) : null}
          </View>

          {prepared && !preparing ? <Notice>{R.preparedNotice}</Notice> : null}
          {params.noLink ? <Notice>{R.noLink(!!fallback)}</Notice> : null}
          {blocked ? (
            <View style={[styles.card, { borderColor: colors.busy }]}>
              <Text style={styles.cardTitle} accessibilityRole="header">{R.blockedTitle}</Text>
              <Text style={styles.p}>
                {R.blockedBody(opName, portal?.roamingBadgesAccepted?.length ? portal.roamingBadgesAccepted.join(', ') : null)}
              </Text>
              {alternative ? (
                <Button
                  label={R.nearestPayable(displayName(alternative.s), km(alternative.d))}
                  variant="secondary"
                  onPress={() => {
                    store.setCurrent(alternative.s);
                    router.replace({ pathname: '/recharger', params: { station: alternative.s.id } });
                  }}
                />
              ) : null}
              <Button label={R.myBadges} variant="ghost" onPress={() => router.push('/comptes')} />
            </View>
          ) : null}
          {/* Méthode recommandée + mode d'emploi */}
          {chosen && !blocked ? (
            <View style={[styles.card, styles.methodCard]}>
              <View style={styles.rowWrap}>
                <Text style={[styles.cardTitle, { flexShrink: 1 }]} accessibilityRole="header">
                  {chosen.label}
                </Text>
                {chosen.id === (fallback ?? options[0])?.id ? <Tag>{t.common.recommended}</Tag> : null}
              </View>
              <Text style={styles.p}>{chosen.why}</Text>
              <Text style={styles.orderText}>{chosen.order === 'plug-first' ? R.plugFirst : R.payFirst}</Text>
              {chosen.steps.map((s, i) => (
                <View key={s} style={styles.stepRow}>
                  <View style={styles.num}>
                    <Text style={styles.numText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepLine, { flex: 1 }]}>{s}</Text>
                </View>
              ))}
              {chosen.copyId ? <CopyId id={chosen.copyId} /> : null}
              <Text style={styles.small}>{R.followStation}</Text>
              {preparing ? <Text style={styles.small}>{R.prepNote}</Text> : null}
              <Button label={preparing ? R.saveForArrival : chosen.cta} onPress={() => go(chosen)} disabled={!chosen.available} hint={chosen.id === 'reader' ? R.hintReader : R.hintQr} />
            </View>
          ) : null}

          <Text style={styles.h3}>{R.otherMethods}</Text>
          {options
            .filter((o) => o.id !== chosen?.id)
            .map((o) => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: !o.available }}
                accessibilityLabel={`${o.label}${o.available ? '' : R.unavailableSuffix}`}
                disabled={!o.available}
                onPress={() => setMethod(o.id)}
                style={({ pressed }) => [styles.alt, !o.available && styles.altOff, pressed && { backgroundColor: colors.surfaceAlt }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.altTitle}>{o.label}</Text>
                  <Text style={styles.small} numberOfLines={3}>
                    {o.why}
                  </Text>
                </View>
                {!o.available ? <Tag>{t.common.unavailable}</Tag> : <Text style={styles.linkText}>{t.common.choose}</Text>}
              </Pressable>
            ))}
          {station.tel ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${station.tel!.replace(/[^+\d]/g, '')}`)} style={styles.link}>
              <Text style={styles.linkText}>{R.callDoubt(opName)}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.small}>{R.neverSee(opName)}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function PointRow({ p, onPress, selected, disabled, status }: { p: ChargePoint; onPress?: () => void; selected?: boolean; disabled?: boolean; status?: AvailItem }) {
  const R = useT().recharger;
  const dc = isDc(p.kw, p.plugs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={R.pointRowA11y(p.short.split('').join(' '), kw(p.kw), p.plugs.map((x) => plugLabel(x)).join(', '), !!disabled, status && status.status !== 'inconnu' ? availLabel(status.status) : null)}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.point, selected && styles.pointOn, disabled && styles.altOff, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={styles.label}>
        <Text style={styles.labelSmall}>{p.id.length > 4 ? '…' : ''}</Text>
        <Text style={styles.labelBig}>{p.short}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.altTitle}>
          {kw(p.kw)} · {dc ? R.fast : R.normal}
        </Text>
        <Text style={styles.small} numberOfLines={2}>
          {p.plugs.map((x) => plugLabel(x)).join(', ') || R.plugUnknown}
          {p.exact ? '' : R.stationPlugs} · {p.id}
        </Text>
      </View>
      {status && status.status !== 'inconnu' ? (
        <View style={[styles.pill, status.status === 'libre' ? styles.pillFree : status.status === 'occupe' ? styles.pillBusy : styles.pillDown]}>
          <Text style={[styles.pillText, status.status === 'libre' ? { color: colors.accentPressed } : status.status === 'occupe' ? { color: '#7A3E06' } : { color: colors.danger }]}>{availLabel(status.status)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.big}>
      <Text style={styles.bigLabel}>{label}</Text>
      <Text style={styles.bigValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  body: { paddingHorizontal: 16, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: MIN_TOUCH, paddingHorizontal: 14 },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 21, color: colors.ink },
  h1: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  h2: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  h3: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, marginTop: 4 },
  p: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  row: { flexDirection: 'row', gap: 8 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  half: { flex: 1, minHeight: 48 },
  vehicleCard: { backgroundColor: colors.accentSoft, borderRadius: radius.lg, padding: 14, gap: 8 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 14, gap: 10 },
  methodCard: { borderWidth: 2, borderColor: colors.accent },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 72, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  pointOn: { borderColor: colors.accent, borderWidth: 2 },
  label: { minWidth: 82, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.ink, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  labelSmall: { fontFamily: fonts.medium, fontSize: 14, color: colors.nightMuted },
  labelBig: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 1, color: '#FFFFFF' },
  pill: { borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 },
  pillFree: { backgroundColor: colors.accentSoft },
  pillBusy: { backgroundColor: colors.warnSoft },
  pillDown: { backgroundColor: '#FDECEC' },
  pillText: { fontFamily: fonts.bold, fontSize: 12 },
  pointChip: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  pointShort: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, letterSpacing: 1 },
  estimate: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12, gap: 8 },
  estLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  estRow: { flexDirection: 'row', gap: 8 },
  big: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 8, gap: 2 },
  bigLabel: { fontFamily: fonts.semibold, fontSize: 11, color: colors.inkMuted },
  bigValue: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  socRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink },
  socValue: { fontFamily: fonts.display, fontSize: 18, color: colors.ink, minWidth: 54, textAlign: 'center' },
  preauth: { gap: 4 },
  orderText: { fontFamily: fonts.bold, fontSize: 14, color: colors.accentPressed },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
  stepLine: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.ink },
  alt: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  altOff: { opacity: 0.6 },
  altTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
});
