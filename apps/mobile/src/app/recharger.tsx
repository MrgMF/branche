// Parcours « Recharger ici » : point de charge → prix avant de payer → méthode recommandée et mode d'emploi.
// Une seule action principale par étape. Ouvert par la détection de proximité, le scan d'un QR code, la fiche
// station, l'arrivée du guidage, ou un lien profond branche://recharger?evse=FR*ABC*E123 (web : /recharger?evse=).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TariffLines } from '../components/Pricing';
import { Button, Notice, Tag } from '../components/ui';
import { getCommunity, preauthText, type Community } from '../lib/community';
import { operatorLabel, payOptions, runPlan, type PayOption } from '../lib/connectors';
import { AVAIL_LABEL, getAvailability, type AvailItem } from '../lib/availability';
import { clearPrepared, loadPrepared, savePrepared, type Prepared } from '../lib/prepared';
import { durationLabel, estimateCharge, isDc } from '../lib/estimate';
import { findStation, pointById, pointsOf, type ChargePoint } from '../lib/evse';
import { euros, kw, PLUG_LABEL } from '../lib/format';
import type { MethodId } from '../lib/history';
import type { Operator } from '../lib/qr';
import { displayName, loadOperators, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { parseTariff } from '../lib/tariff';
import { compatible, loadVehicle, saveVehicle, type Vehicle } from '../lib/vehicle';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

const SKIP_KEY = 'branche.vehicle.skipped.v1';
const SOC_FRESH_MS = 3 * 3600_000;

export default function Recharger() {
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

  useEffect(() => {
    loadOperators().then(setOps);
    loadVehicle().then((v) => {
      setVehicle(v);
      if (v && Date.now() - v.socUpdatedAt < SOC_FRESH_MS) setSoc(v.socPercent);
    });
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
  const options = useMemo(() => (station ? payOptions(station, point, ops) : []), [station, point, ops]);
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
        <Text style={styles.muted}>Recherche de la borne…</Text>
      </View>
    );
  }
  if (!station) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.h1} accessibilityRole="header">Borne introuvable</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          {params.evse ? `L’identifiant ${params.evse} n’est pas dans la base nationale des bornes, ou la connexion est coupée.` : 'Choisissez une borne sur la carte.'}
        </Text>
        <Button label="Scanner le QR code de la borne" onPress={() => router.replace('/payer')} style={{ alignSelf: 'stretch' }} />
        <Button label="Retour à la carte" variant="ghost" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  // Proposé au 1er passage (au choix du point, ou directement s'il n'y a qu'un point) ; jamais bloquant
  if (savedPrep) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.h1} accessibilityRole="header">Tout est prêt</Text>
        <Text style={[styles.p, { textAlign: 'center' }]}>
          À votre arrivée à {displayName(station)}, Branché affichera « Payer maintenant » : un seul geste pour {chosen?.id === 'reader' ? 'le mode d’emploi du lecteur de carte' : 'ouvrir la bonne page de paiement'}.
        </Text>
        <Notice>Rien n’est débité maintenant : vous payez à la borne, directement à {opName}. Le prépaiement et la réservation demandent un partenariat avec les opérateurs, pas encore en place.</Notice>
        <Button label="Retour à la carte" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  const vehiclePrompt = vehicle === null && !skipped && (step === 'point' || usable.length < 2);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.head}>
        <Button label="Retour" variant="ghost" onPress={back} style={styles.back} />
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{preparing ? 'Préparer ma recharge · ' : ''}{step === 'point' ? 'Étape 1 sur 2' : points.length > 1 || autoPoint === null ? 'Étape 2 sur 2' : 'Recharger ici'}</Text>
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
            {displayName(station)}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {opName}
          </Text>
        </View>
      </View>

      {vehiclePrompt ? (
        <View style={styles.vehicleCard}>
          <Text style={styles.cardTitle}>Votre véhicule ?</Text>
          <Text style={styles.p}>Pour filtrer les prises compatibles et estimer durée et prix. Facultatif, enregistré sur ce téléphone.</Text>
          <View style={styles.row}>
            <Button label="Choisir" variant="secondary" onPress={() => router.push('/vehicule')} style={styles.half} />
            <Button label="Passer" variant="ghost" onPress={skipVehicle} style={styles.half} />
          </View>
        </View>
      ) : null}

      {step === 'point' ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.h2} accessibilityRole="header">Choisissez votre point de charge</Text>
          <Text style={styles.p}>Les 4 derniers caractères sont inscrits sur l’étiquette de la borne ou de la prise.</Text>
          {usable.map((p) => (
            <PointRow key={p.id} p={p} onPress={() => pick(p)} selected={p.id === pointId} status={avail[p.id]} />
          ))}
          {!usable.length ? <Notice tone="demo">Aucun point compatible avec {vehicle?.name ?? 'votre véhicule'} dans la base nationale. Vérifiez sur place.</Notice> : null}
          {incompatible.length ? (
            <>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showIncompatible }} onPress={() => setShowIncompatible((x) => !x)} style={styles.link}>
                <Text style={styles.linkText}>
                  {showIncompatible ? 'Masquer' : 'Afficher'} {incompatible.length} point{incompatible.length > 1 ? 's' : ''} incompatible{incompatible.length > 1 ? 's' : ''} avec {vehicle?.name ?? 'votre véhicule'}
                </Text>
              </Pressable>
              {showIncompatible ? incompatible.map((p) => <PointRow key={p.id} p={p} disabled />) : null}
            </>
          ) : null}
          {station.p > points.length ? <Text style={styles.small}>{station.p - points.length} autre(s) point(s) non détaillé(s) par l’opérateur.</Text> : null}
        </View>
      ) : point && est ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Point ${point.short}, ${kw(point.kw)}. Changer de point`}
            onPress={() => {
              setChoosing(true);
            }}
            style={styles.pointChip}
            disabled={points.length < 2}
          >
            <Text style={styles.pointShort}>…{point.short}</Text>
            <Text style={[styles.p, { flex: 1 }]} numberOfLines={2}>
              {kw(point.kw)} · {point.plugs.map((p) => PLUG_LABEL[p]).join(', ')}
            </Text>
            {points.length > 1 ? <Text style={styles.linkText}>Changer</Text> : null}
          </Pressable>

          {/* Prix avant de payer */}
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">Prix avant de payer</Text>
            <TariffLines station={station} community={community} />
            <View style={styles.estimate} accessibilityRole="summary">
              <Text style={styles.estLabel}>
                Estimation pour {est.assumedVehicle ? 'un véhicule moyen (55 kWh)' : vehicle?.name}, de {est.fromSoc} % à {est.toSoc} %
              </Text>
              <View style={styles.estRow}>
                <Big label="Énergie" value={`${est.kWhBilled.toLocaleString('fr-FR')} kWh`} />
                <Big label="Durée" value={`≈ ${durationLabel(est.minutes)}`} />
                <Big label="Coût" value={est.cost != null ? `≈ ${euros(Math.round(est.cost * 100))}` : 'Inconnu'} />
              </View>
              <Text style={styles.small}>
                Puissance {kw(est.powerKw)} ({isDc(point.kw, point.plugs) ? 'courant continu, ralentit après 50 %' : 'courant alternatif'}) : le minimum entre le point ({kw(point.kw)}) et {est.assumedVehicle ? 'un véhicule moyen' : 'votre véhicule'}. Pertes de charge incluses.
                {est.partial ? ' Seule une partie du tarif est publiée.' : ''}
                {est.unknownPrice ? ' Prix inconnu : vérifiez l’écran de la borne avant de valider.' : ''}
              </Text>
              <View style={styles.socRow}>
                <Text style={[styles.p, { flex: 1 }]}>Batterie actuelle{soc == null ? ' (supposée)' : ''}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Batterie moins 5 %" onPress={() => changeSoc(-5)} style={styles.step}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.socValue} accessibilityLabel={`Batterie ${soc ?? 20} %`}>
                  {soc ?? 20} %
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Batterie plus 5 %" onPress={() => changeSoc(5)} style={styles.step}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
              {vehicle ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/vehicule')} style={styles.link}>
                  <Text style={styles.linkText}>Changer de véhicule</Text>
                </Pressable>
              ) : skipped ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/vehicule')} style={styles.link}>
                  <Text style={styles.linkText}>Préciser mon véhicule</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.preauth}>
              <Text style={styles.estLabel}>Pré-autorisation</Text>
              <Text style={styles.small}>
                Avec une carte bancaire, la borne ou la page de paiement peut bloquer un montant le temps de la recharge (souvent plus que le coût réel). Seul le montant réel est débité ; le reste est libéré par votre banque, en général sous quelques jours. {opName} ne publie pas ce montant.
              </Text>
              {preauthText(community) ? <Text style={[styles.small, { color: colors.ink }]}>{preauthText(community)}</Text> : null}
            </View>
            {tariff.idle ? (
              <Notice tone="demo">
                Occupation facturée après la fin de charge{tariff.idle.afterMin ? ` (au-delà de ${tariff.idle.afterMin} min)` : ''} : Branché vous prévient avant.
              </Notice>
            ) : null}
          </View>

          {prepared && !preparing ? <Notice>Recharge préparée : point et méthode repris. Il ne reste qu’à payer.</Notice> : null}
          {params.noLink ? <Notice>Borne et point identifiés par le QR code. Il ne contient pas de lien de paiement : {fallback ? 'utilisez la méthode ci-dessous.' : 'cherchez un autre QR code ou le lecteur de carte sur la borne.'}</Notice> : null}
          {/* Méthode recommandée + mode d'emploi */}
          {chosen ? (
            <View style={[styles.card, styles.methodCard]}>
              <View style={styles.rowWrap}>
                <Text style={[styles.cardTitle, { flexShrink: 1 }]} accessibilityRole="header">
                  {chosen.label}
                </Text>
                {chosen.id === (fallback ?? options[0])?.id ? <Tag>Recommandé</Tag> : null}
              </View>
              <Text style={styles.p}>{chosen.why}</Text>
              <Text style={styles.orderText}>{chosen.order === 'plug-first' ? 'Brancher d’abord, puis payer' : 'Payer d’abord, puis brancher'}</Text>
              {chosen.steps.map((s, i) => (
                <View key={s} style={styles.stepRow}>
                  <View style={styles.num}>
                    <Text style={styles.numText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.stepLine, { flex: 1 }]}>{s}</Text>
                </View>
              ))}
              <Text style={styles.small}>Si l’écran de la borne indique un autre ordre, suivez la borne.</Text>
              {preparing ? <Text style={styles.small}>Préparation : rien n’est payé maintenant. À l’arrivée, un geste suffira.</Text> : null}
              <Button label={preparing ? 'Enregistrer pour mon arrivée' : chosen.cta} onPress={() => go(chosen)} disabled={!chosen.available} hint={chosen.id === 'reader' ? 'Ouvre le suivi de la recharge' : 'Branché vérifie le QR code avant d’ouvrir la page de l’opérateur'} />
            </View>
          ) : null}

          <Text style={styles.h3}>Autres méthodes</Text>
          {options
            .filter((o) => o.id !== chosen?.id)
            .map((o) => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: !o.available }}
                accessibilityLabel={`${o.label}${o.available ? '' : ', indisponible'}`}
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
                {o.id === 'branche-card' ? <Tag>Bientôt</Tag> : !o.available ? <Tag>Indisponible</Tag> : <Text style={styles.linkText}>Choisir</Text>}
              </Pressable>
            ))}
          {station.tel ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${station.tel!.replace(/[^+\d]/g, '')}`)} style={styles.link}>
              <Text style={styles.linkText}>Un doute ? Appeler {opName}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.small}>Branché ne voit jamais votre carte et n’encaisse rien : vous payez directement {opName}.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function PointRow({ p, onPress, selected, disabled, status }: { p: ChargePoint; onPress?: () => void; selected?: boolean; disabled?: boolean; status?: AvailItem }) {
  const dc = isDc(p.kw, p.plugs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Point se terminant par ${p.short.split('').join(' ')}, ${kw(p.kw)}, ${p.plugs.map((x) => PLUG_LABEL[x]).join(', ')}${disabled ? ', incompatible' : ''}`}
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
          {kw(p.kw)} · {dc ? 'rapide (DC)' : 'normal (AC)'}
        </Text>
        <Text style={styles.small} numberOfLines={2}>
          {p.plugs.map((x) => PLUG_LABEL[x]).join(', ') || 'Prise non précisée'}
          {p.exact ? '' : ' (prises de la station)'} · {p.id}
        </Text>
      </View>
      {status && status.status !== 'inconnu' ? (
        <View style={[styles.pill, status.status === 'libre' ? styles.pillFree : status.status === 'occupe' ? styles.pillBusy : styles.pillDown]}>
          <Text style={[styles.pillText, status.status === 'libre' ? { color: colors.accentPressed } : status.status === 'occupe' ? { color: '#7A3E06' } : { color: colors.danger }]}>{AVAIL_LABEL[status.status]}</Text>
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
