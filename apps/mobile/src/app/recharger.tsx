// Parcours « Recharger ici » : point de charge → prix avant de payer → méthode recommandée et mode d'emploi.
// Une seule action principale par étape. Ouvert par la détection de proximité, le scan d'un QR code, la fiche
// station, l'arrivée du guidage, ou un lien profond branche://recharger?evse=FR*ABC*E123 (web : /recharger?evse=).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CopyId } from '../components/CopyId';
import { costLabel, TariffLines } from '../components/Pricing';
import { Button, Notice, Tag } from '../components/ui';
import { getCommunity, preauthText, reliabilityText, type Community } from '../lib/community';
import { operatorLabel, payOptions, runPlan, type PayOption } from '../lib/connectors';
import { availLabel, getAvailability, type AvailItem } from '../lib/availability';
import { clearPrepared, loadPrepared, savePrepared, type Prepared } from '../lib/prepared';
import { durationLabel, estimateCharge, isDc } from '../lib/estimate';
import { findStation, pointById, pointsOf, type ChargePoint } from '../lib/evse';
import { km, kw, NBSP, plugLabel, withUnit } from '../lib/format';
import { useLargeText } from '../lib/useLargeText';
import type { MethodId } from '../lib/history';
import type { Operator } from '../lib/qr';
import { displayName, loadAround, loadOperators, nearest, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { describeTariff, stationTariff } from '../lib/tariff';
import { compatible, loadVehicle, saveVehicle, type Vehicle } from '../lib/vehicle';
import { loadWallet, type Wallet } from '../lib/accounts';
import { appLaunchOption, appOnly, badgeMentioned, badgeNames, nearestPayable, showsAccepted, surelyPayable } from '../lib/methods';
import { AcceptedMethods, acceptedA11y } from '../components/AcceptedMethods';
import { loadPortals, portalPaid, preauthMaxOf, type AppOS, type Portals } from '../lib/portals';
import { colors, fonts, mapColors, MIN_TOUCH, radius } from '../theme';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/Screen';
import { useLocale, useT } from '../i18n';
import { eur, kwhText } from '../i18n/format';

const SKIP_KEY = 'branche.vehicle.skipped.v1';
const SOC_FRESH_MS = 3 * 3600_000;

export default function Recharger() {
  const t = useT();
  const R = t.recharger;
  const { lang } = useLocale();
  const insets = useSafeAreaInsets();
  // Texte agrandi (≥ 130 %) : titres sur plusieurs lignes, tuiles empilées, marges des boutons texte proportionnelles
  const large = useLargeText();
  const { fontScale } = useWindowDimensions();
  const pad = Math.round(8 * Math.min(2, Math.max(1, fontScale)));
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
  // Stations voisines chargées ici quand l'écran est ouvert par lien profond (carte jamais chargée)
  const [around, setAround] = useState<Station[] | null>(null);
  const [preauthOpen, setPreauthOpen] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [offline, setOffline] = useState(false);
  const preparing = params.prepare === '1';

  // Station et point depuis le lien, la sélection courante ou l'index EVSE
  useEffect(() => {
    let alive = true;
    (async () => {
      // Page rechargée (/recharger?station=…) : borne et plan relus sur l'appareil avant tout (sinon setCurrent écraserait
      // le plan enregistré et le point choisi serait perdu)
      await store.hydrate();
      if (!alive) return;
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

  const tariff = useMemo(() => stationTariff(station ?? {}), [station]);
  const est = useMemo(
    () => (point ? estimateCharge({ vehicle: vehicle ?? null, socPercent: soc, pointKw: point.kw, plugs: point.plugs, tariff }) : null),
    [point, vehicle, soc, tariff],
  );
  const os: AppOS = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  const options = useMemo(() => (station ? payOptions(station, point, ops, { portals, wallet, os }) : []), [station, point, ops, portals, wallet, os, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  // Passerelle « Démarrer avec l'appli » (réseau « appli seule » avec lien/fiche sourcés) : action principale honnête,
  // Branché n'y paie rien. La borne payable la plus proche reste proposée par le bloc « bloqué ».
  const appChoice = appLaunchOption(options);
  const readerOk = options.some((o) => o.id === 'reader' && o.available && !o.speculative);
  const portal = station?.ok ? portals[station.ok] : undefined;
  // Réseau payant notoire (sources) : une gratuité IRVE non crédible devient « tarif non publié », coût « Inconnu »
  const paidNetwork = portalPaid(portal);
  const accountConnected = !!station?.ok && wallet.accounts.some((a) => a.operatorKey === station.ok);
  // Rien de payable ici depuis Branché : alternative la plus proche qui l'est (méthode déclarée, pas un QR « éventuel »).
  // `blocked` ne compte que les options disponibles ET non spéculatives ; `unconfirmed` : seulement du spéculatif
  // (QR « éventuel », lecteur « sur certains sites ») → « Non confirmé ici », à essayer sur place ou borne payable proposée.
  const blocked = !surelyPayable(options);
  const unconfirmed = blocked && !appOnly(options);
  useEffect(() => {
    if (!blocked || !station || store.stations().length || around) return;
    loadAround(station, 1)
      .then(setAround)
      .catch(() => setAround([]));
  }, [blocked, station, around]);
  const pool = store.stations().length ? store.stations() : (around ?? []);
  const alternative = useMemo(() => {
    if (!blocked || !station) return null;
    const near = nearest(pool.filter((x) => x.id !== station.id && x.acc !== 'reserve' && compatible(x.c, vehicle)), station, 40);
    return nearestPayable(near, ops, { portals, wallet });
  }, [blocked, station, ops, portals, wallet, vehicle, pool]);
  const searchingAlt = blocked && !store.stations().length && around === null;
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
      stationKw: station.kw,
      pay: station.pay,
    });
    const plan = store.plan()!;
    if (preparing) {
      savePrepared({ station, plan, operatorName: opName, url: o.url, estimatedCost: est?.cost ?? null, createdAt: Date.now() });
      setSavedPrep(true);
      return;
    }
    if (prepared) clearPrepared();
    setOffline(false);
    runPlan(station, plan, opName, o.url, o.store).then((r) => setOffline(r === 'offline'));
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

  // Étape 2 : l'action de la méthode choisie reste fixée en bas de l'écran (toujours à portée de pouce)
  const sticky = step === 'pay' && !!point && !!est && !!chosen && !blocked;
  return (
    <View style={styles.root}>
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + (sticky ? 112 : 28) }]}>
      <ScreenHeader
        onBack={back}
        kicker={`${preparing ? R.prepKicker : ''}${step === 'point' ? R.step1 : points.length > 1 || autoPoint === null ? R.step2 : t.titles.recharger}`}
        title={displayName(station)}
        sub={opName}
        titleLines={large ? 0 : 2}
        subLines={large ? 0 : 2}
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
            <PointRow key={p.id} p={p} onPress={() => pick(p)} selected={p.id === pointId} status={avail[p.id]} large={large} />
          ))}
          {!usable.length ? <Notice tone="demo">{R.noCompatible(vehicle?.name ?? R.yourVehicle)}</Notice> : null}
          {incompatible.length ? (
            <>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showIncompatible }} onPress={() => setShowIncompatible((x) => !x)} style={styles.link}>
                <Text style={styles.linkText}>
                  {R.toggleIncompatible(showIncompatible, incompatible.length, vehicle?.name ?? R.yourVehicle)}
                </Text>
              </Pressable>
              {showIncompatible ? incompatible.map((p) => <PointRow key={p.id} p={p} disabled large={large} />) : null}
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
            style={[styles.pointChip, large && styles.pointChipLarge]}
            disabled={points.length < 2}
          >
            <Text style={styles.pointShort}>…{point.short}</Text>
            <Text style={[styles.p, !large && { flex: 1 }]}>
              {kw(point.kw)} · {point.plugs.map((p) => plugLabel(p)).join(', ')}
            </Text>
            {points.length > 1 ? <Text style={[styles.linkText, large && { minHeight: MIN_TOUCH, lineHeight: MIN_TOUCH }]}>{t.common.change}</Text> : null}
          </Pressable>

          {/* Prix avant de payer */}
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">{R.priceBefore}</Text>
            <TariffLines station={station} community={community} paidNetwork={paidNetwork} />
            <View style={styles.estimate} accessibilityRole="summary">
              <Text style={styles.estLabel}>
                {withUnit(R.estimateFor(est.assumedVehicle ? R.avgVehicle55 : vehicle?.name ?? '', est.fromSoc, est.toSoc))}
              </Text>
              <View style={[styles.estRow, large && { flexDirection: 'column' }]}>
                <Big label={R.energy} value={withUnit(kwhText(est.kWhBilled))} large={large} />
                <Big label={R.duration} value={withUnit(`≈${NBSP}${durationLabel(est.minutes)}`)} large={large} />
                <Big label={R.cost} value={costLabel(est, paidNetwork, `≈${NBSP}`)} large={large} />
              </View>
              <Text style={styles.small}>
                {withUnit(R.powerNote(kw(est.powerKw), isDc(point.kw, point.plugs), kw(point.kw), est.assumedVehicle))}
                {est.partial ? R.partial : ''}
                {est.unknownPrice && !est.freeDoubtful && (describeTariff(tariff).length || tariff.kind === 'link') ? R.unknownPriceNote : ''}
              </Text>
              <View style={[styles.socRow, large && styles.socRowLarge]}>
                <Text style={[styles.p, !large && { flex: 1 }, large && { width: '100%' }]}>{R.socNow(soc == null)}</Text>
                {/* Texte agrandi : valeur sur sa ligne, puis − et + côte à côte (tient dans 195 px) */}
                {large ? (
                  <Text style={[styles.socValue, { width: '100%', textAlign: 'left' }]} accessibilityLabel={R.socA11y(soc ?? 20)}>
                    {withUnit(soc ?? 20, '%')}
                  </Text>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel={R.socMinus} onPress={() => changeSoc(-5)} style={styles.step}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                {large ? null : (
                  <Text style={styles.socValue} accessibilityLabel={R.socA11y(soc ?? 20)}>
                    {withUnit(soc ?? 20, '%')}
                  </Text>
                )}
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
              {/* Repliable : l'essentiel (montant publié s'il existe) reste visible */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: preauthOpen }}
                onPress={() => setPreauthOpen((x) => !x)}
                style={styles.preauthHead}
              >
                <Text style={[styles.estLabel, { flex: 1 }]}>
                  {R.preauth}
                  {preauthMaxOf(portal) != null ? ` · ${eur(preauthMaxOf(portal)!, 0)}` : ''}
                </Text>
                <View style={{ transform: [{ rotate: preauthOpen ? '-90deg' : '90deg' }] }}>
                  <Icon name="chevron" size={18} color={colors.accentPressed} />
                </View>
              </Pressable>
              {preauthOpen ? (
                <>
                  <Text style={styles.small}>
                    {preauthMaxOf(portal) != null ? R.preauthMax(opName, eur(preauthMaxOf(portal)!, 0)) : R.preauthBody(opName)}
                  </Text>
                  {preauthText(community) ? <Text style={[styles.small, { color: colors.ink }]}>{preauthText(community)}</Text> : null}
                </>
              ) : null}
            </View>
            {tariff.idle ? (
              <Notice tone="demo">
                {R.idle(tariff.idle.afterMin)}
              </Notice>
            ) : null}
          </View>

          {prepared && !preparing ? <Notice>{R.preparedNotice}</Notice> : null}
          {params.noLink ? <Notice>{R.noLink(!!fallback)}</Notice> : null}
          {/* Passerelle « Démarrer avec l'appli » : action principale honnête pour un réseau « appli seule » (Branché n'y paie pas) */}
          {appChoice ? (
            <View style={[styles.card, styles.methodCard]}>
              <View style={styles.rowWrap}>
                <Text style={[styles.cardTitle, { flexShrink: 1 }]} accessibilityRole="header">{appChoice.label}</Text>
                {/* Appli de l'opérateur seule voie ici : « Seule option ici » (honnête), pas « Recommandé ». */}
                {blocked ? <Tag>{appOnly(options) ? t.common.onlyOption : t.common.recommended}</Tag> : null}
              </View>
              <Text style={styles.p}>{appChoice.why}</Text>
              <Text style={styles.orderText}>{appChoice.order === 'plug-first' ? R.plugFirst : R.payFirst}</Text>
              {appChoice.steps.map((s, i) => (
                <View key={s} style={styles.stepRow}>
                  <View style={styles.num}>
                    <Text style={styles.numText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepLine, { flex: 1 }]}>{s}</Text>
                </View>
              ))}
              <Text style={styles.small}>{R.followStation}</Text>
              {preparing ? <Text style={styles.small}>{R.prepNote}</Text> : null}
              <Button label={preparing ? R.saveForArrival : appChoice.cta} onPress={() => go(appChoice)} hint={R.hintApp} />
              {offline ? <Notice tone="error">{t.common.noNetwork}</Notice> : null}
            </View>
          ) : null}
          {blocked ? (
            <View style={[styles.card, { borderColor: colors.busy }]}>
              <Text style={styles.cardTitle} accessibilityRole="header">{unconfirmed ? R.unconfirmedTitle : R.blockedTitle}</Text>
              <Text style={styles.p}>
                {unconfirmed ? R.unconfirmedBody(opName) : R.blockedBody(opName, badgeNames(portal?.roamingBadgesAccepted).join(', ') || null, badgeMentioned(station))}
              </Text>
              {alternative ? (
                <>
                  <Text style={[styles.p, { color: colors.ink }]}>{R.nearestPayable(displayName(alternative.s), km(alternative.d))}</Text>
                  <Button
                    label={R.goThere}
                    hint={R.goThereHint(displayName(alternative.s))}
                    onPress={() => {
                      store.setCurrent(alternative.s);
                      router.replace({ pathname: '/', params: { go: alternative.s.id } });
                    }}
                  />
                </>
              ) : searchingAlt ? (
                <Text style={styles.small}>{R.searchingPayable}</Text>
              ) : (
                <Text style={styles.small}>{R.noPayableNear}</Text>
              )}
              {badgeMentioned(station) ? <Button label={R.myBadges} variant="ghost" onPress={() => router.push('/comptes')} /> : null}
            </View>
          ) : null}
          {/* Méthode recommandée + mode d'emploi (non confirmé : la méthode éventuelle reste lisible, à essayer sur place) */}
          {chosen && (!blocked || (unconfirmed && chosen.available)) ? (
            <View style={[styles.card, styles.methodCard]}>
              <View style={styles.rowWrap}>
                <Text style={[styles.cardTitle, { flexShrink: 1 }]} accessibilityRole="header">
                  {chosen.label}
                </Text>
                {chosen.id === (fallback ?? options[0])?.id && !chosen.speculative ? <Tag>{t.common.recommended}</Tag> : null}
              </View>
              <Text style={styles.p}>{chosen.why}</Text>
              {showsAccepted(chosen) ? <AcceptedMethods portal={portal} channel={showsAccepted(chosen)!} wallet /> : null}
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
              {/* Non confirmé : action secondaire dans la carte (l'action principale reste « Y aller ») */}
              {blocked && unconfirmed && !preparing ? <Button label={chosen.cta} variant="secondary" onPress={() => go(chosen)} disabled={!chosen.available} /> : null}
              {blocked && offline ? <Notice tone="error">{readerOk ? t.common.noNetworkReader : t.common.noNetwork}</Notice> : null}
            </View>
          ) : null}

          <Text style={styles.h3}>{R.otherMethods}</Text>
          {(() => {
            const others = options.filter((o) => o.id !== chosen?.id && o.id !== 'operator-app');
            const availableOthers = others.filter((o) => o.available);
            const unavailableOthers = others.filter((o) => !o.available);
            // Les moyens indisponibles sont repliés derrière « Voir les autres moyens » : une seule action principale visible.
            const row = (o: PayOption) => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: !o.available }}
                accessibilityLabel={`${o.label}${o.available ? '' : R.unavailableSuffix}`}
                accessibilityHint={acceptedA11y(t, portal, showsAccepted(o)) || undefined}
                disabled={!o.available}
                onPress={() => setMethod(o.id)}
                style={({ pressed }) => [styles.alt, large && { flexDirection: 'column', alignItems: 'stretch' }, !o.available && styles.altOff, pressed && { backgroundColor: colors.surfaceAlt }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.altTitle}>{o.label}</Text>
                  <Text style={styles.small}>{o.why}</Text>
                  {showsAccepted(o) ? <AcceptedMethods portal={portal} channel={showsAccepted(o)!} /> : null}
                </View>
                {!o.available ? (
                  <Tag>{t.common.unavailable}</Tag>
                ) : (
                  <View style={[styles.choosePill, { paddingHorizontal: pad * 1.5, paddingVertical: pad / 2 }, large && { alignSelf: 'flex-start' }]}>
                    <Text style={styles.linkText}>{t.common.choose}</Text>
                  </View>
                )}
              </Pressable>
            );
            return (
              <>
                {availableOthers.map(row)}
                {unavailableOthers.length ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showUnavailable }}
                      onPress={() => setShowUnavailable((x) => !x)}
                      style={styles.link}
                    >
                      <Text style={styles.linkText}>{R.showUnavailable(showUnavailable)}</Text>
                    </Pressable>
                    {showUnavailable ? unavailableOthers.map(row) : null}
                  </>
                ) : null}
              </>
            );
          })()}
          {station.tel ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${station.tel!.replace(/[^+\d]/g, '')}`)} style={styles.link}>
              <Text style={styles.linkText}>{R.callDoubt(opName)}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.small}>{R.neverSee(opName)}</Text>
        </>
      ) : null}
    </ScrollView>
      {sticky && chosen ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.footerIn}>
            {offline ? (
              <View accessibilityLiveRegion="assertive" role="alert" style={{ marginBottom: 8 }}>
                <Notice tone="error">{readerOk ? t.common.noNetworkReader : t.common.noNetwork}</Notice>
              </View>
            ) : null}
            <Button label={preparing ? R.saveForArrival : chosen.cta} onPress={() => go(chosen)} disabled={!chosen.available} hint={chosen.id === 'reader' ? R.hintReader : R.hintQr} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PointRow({ p, onPress, selected, disabled, status, large }: { p: ChargePoint; onPress?: () => void; selected?: boolean; disabled?: boolean; status?: AvailItem; large?: boolean }) {
  const R = useT().recharger;
  const dc = isDc(p.kw, p.plugs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={R.pointRowA11y(p.short.split('').join(' '), kw(p.kw), p.plugs.map((x) => plugLabel(x)).join(', '), !!disabled, status && status.status !== 'inconnu' ? availLabel(status.status) : null)}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.point, large && styles.pointLarge, selected && styles.pointOn, disabled && styles.altOff, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={[styles.label, selected && styles.labelOn]}>
        <Text style={[styles.labelSmall, selected && { color: '#FFFFFF' }]}>{p.id.length > 4 ? '…' : ''}</Text>
        <Text style={[styles.labelBig, selected && { color: '#FFFFFF' }]}>{p.short}</Text>
      </View>
      <View style={large ? { gap: 2, alignSelf: 'stretch' } : { flex: 1, gap: 2 }}>
        <Text style={styles.altTitle}>
          {kw(p.kw)} · {dc ? R.fast : R.normal}
        </Text>
        <Text style={styles.small}>
          {p.plugs.map((x) => plugLabel(x)).join(', ') || R.plugUnknown}
          {p.exact ? '' : R.stationPlugs}
        </Text>
        {/* Identifiant complet sur sa propre ligne (coupé n'importe où plutôt que tronqué) */}
        <Text style={[styles.small, styles.pointId]} selectable>
          {p.id}
        </Text>
      </View>
      {status && status.status !== 'inconnu' ? (
        <View style={[styles.pill, status.status === 'libre' ? styles.pillFree : status.status === 'occupe' ? styles.pillBusy : styles.pillDown]}>
          <Text style={[styles.pillText, status.status === 'libre' ? { color: colors.accentPressed } : status.status === 'occupe' ? { color: colors.warnText } : { color: mapColors.statusDown }]}>{availLabel(status.status)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Big({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <View style={styles.big}>
      <Text style={styles.bigLabel}>{label}</Text>
      {/* Texte agrandi : jamais tronqué ni réduit sur une ligne */}
      {/* Mot (« Inconnu », « Unbekannt ») : police réduite et retour à la ligne permis, jamais tronqué */}
      <Text style={[styles.bigValue, !/\d/.test(value) && value.length > 6 && styles.bigValueLong]} numberOfLines={large || !/\d/.test(value) ? undefined : 1}>
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
  // Texte agrandi : pastille, puissance et statut empilés (aucun défilement horizontal)
  pointLarge: { flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
  pointId: { fontFamily: fonts.medium, wordBreak: 'break-all' } as object,
  pointOn: { borderColor: colors.accent, borderWidth: 2 },
  label: { minWidth: 82, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  labelOn: { backgroundColor: colors.accent },
  labelSmall: { fontFamily: fonts.medium, fontSize: 14, color: colors.accentPressed },
  labelBig: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 1, color: colors.accentPressed },
  pill: { borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 },
  pillFree: { backgroundColor: colors.accentSoft },
  pillBusy: { backgroundColor: colors.warnSoft },
  pillDown: { backgroundColor: colors.surfaceAlt },
  pillText: { fontFamily: fonts.bold, fontSize: 12 },
  pointChip: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.accentSoft },
  pointChipLarge: { flexDirection: 'column', alignItems: 'flex-start', gap: 2, paddingVertical: 8 },
  pointShort: { fontFamily: fonts.display, fontSize: 20, color: colors.accentPressed, letterSpacing: 1 },
  estimate: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12, gap: 8 },
  estLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  estRow: { flexDirection: 'row', gap: 8 },
  big: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: 8, gap: 2 },
  bigLabel: { fontFamily: fonts.semibold, fontSize: 11, color: colors.inkMuted },
  bigValue: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  bigValueLong: { fontSize: 14, lineHeight: 20 },
  socRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  socRowLarge: { flexWrap: 'wrap', justifyContent: 'flex-start' },
  step: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.bold, fontSize: 22, color: colors.accentPressed },
  socValue: { fontFamily: fonts.display, fontSize: 18, color: colors.accentPressed, minWidth: 54, textAlign: 'center' },
  preauth: { gap: 4 },
  preauthHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: MIN_TOUCH },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 16, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerIn: { maxWidth: 600, width: '100%', alignSelf: 'center' },
  orderText: { fontFamily: fonts.bold, fontSize: 14, color: colors.accentPressed },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
  stepLine: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.ink },
  alt: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  altOff: { opacity: 0.6 },
  altTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  choosePill: { minHeight: MIN_TOUCH, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
});
