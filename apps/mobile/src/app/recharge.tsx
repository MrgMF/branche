// Suivi d'une recharge payée directement chez l'opérateur (lecteur de carte, QR vérifié, lien opérateur) :
// démarrage confirmé en un geste (sinon dépannage), estimation en direct, alertes, fin, reçu → historique.
// L'état est persisté : l'app peut être fermée et rouverte à tout moment.
import * as Location from 'expo-location';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CopyId } from '../components/CopyId';
import { Button, Notice } from '../components/ui';
import { apiEnabled } from '../lib/api';
import { sendCheckin } from '../lib/community';
import { durationLabel, estimateCharge, progressAt, type EstimateInput } from '../lib/estimate';
import { euros } from '../lib/format';
import { autoFinish, departed, distanceToStation, recordOf, AUTO_END_M } from '../lib/autoEnd';
import { addRecord, METHOD_LABEL, type ChargeRecord } from '../lib/history';
import { postReport } from '../lib/navigation';
import { cancelAlerts, scheduleAlerts, type Alert } from '../lib/notify';
import { store, type DirectCharge } from '../lib/store';
import { parseTariff } from '../lib/tariff';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

const clock = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
};
const parseEuros = (x: string) => {
  const n = Number(x.replace(/\s|€/g, '').replace(',', '.'));
  return x.trim() && Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : null;
};

function inputOf(d: DirectCharge): EstimateInput {
  const p = d.plan;
  return {
    vehicle: p?.vehicle ?? null,
    socPercent: p?.socPercent ?? null,
    pointKw: p?.pointKw ?? 0,
    plugs: p?.plugs ?? ['t2'],
    tariff: parseTariff(p?.tariffRaw, { free: p?.free }),
  };
}

export default function Recharge() {
  const insets = useSafeAreaInsets();
  const [d, setD] = useState<DirectCharge | null | undefined>(store.direct() ?? undefined);
  const [now, setNow] = useState(Date.now());
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [kwhIn, setKwhIn] = useState('');
  const [preauthIn, setPreauthIn] = useState('');
  const [details, setDetails] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<ChargeRecord | null>(null);

  useEffect(() => {
    if (d === undefined) store.loadDirect().then(setD);
  }, [d]);

  const charging = !!d?.chargeStartedAt && !d.endedAt;

  // Fin automatique : départ de la borne pendant la charge (position suivie sur l'appareil uniquement)
  useEffect(() => {
    if (!charging || !d) return;
    let cur = d;
    let stop = false;
    let sub: Location.LocationSubscription | null = null;
    const onFix = async (lat: number, lon: number, speed: number | null, resume: boolean) => {
      if (stop || cur.endedAt) return;
      const fix = { lat, lon, speed, at: Date.now() };
      const m = distanceToStation(cur, fix);
      if (m != null && m <= AUTO_END_M) {
        if (!cur.lastNearAt || fix.at - cur.lastNearAt > 60_000) {
          cur = { ...cur, lastNearAt: fix.at };
          store.setDirect(cur);
        }
        return;
      }
      if (departed(cur, fix, resume)) {
        stop = true;
        const next = await autoFinish(cur);
        store.setDirect(next);
        setD(next);
      }
    };
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted || stop) return;
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 25, timeInterval: 15_000 }, (p) =>
          onFix(p.coords.latitude, p.coords.longitude, p.coords.speed ?? null, false),
        );
      } catch {
        /* position indisponible : fin manuelle seulement */
      }
    })();
    // Retour dans l'app : état rafraîchi, et départ constaté si l'utilisateur est loin de la borne
    const app = AppState.addEventListener('change', async (st) => {
      if (st !== 'active') return;
      setNow(Date.now());
      try {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        onFix(p.coords.latitude, p.coords.longitude, p.coords.speed ?? null, true);
      } catch {
        /* rien */
      }
    });
    return () => {
      stop = true;
      sub?.remove();
      app.remove();
    };
  }, [charging, d?.chargeStartedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!charging) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [charging]);

  const input = useMemo(() => (d ? inputOf(d) : null), [d]);
  const est = useMemo(() => (input ? estimateCharge(input) : null), [input]);
  const tariff = input?.tariff;

  const update = (patch: Partial<DirectCharge> | null) => {
    const next = patch && d ? { ...d, ...patch } : null;
    store.setDirect(next);
    setD(next);
    setNow(Date.now());
    return next;
  };

  async function started() {
    if (!d || !est || !tariff) return;
    const t0 = Date.now();
    const endAt = t0 + est.minutes * 60_000;
    const alerts: Alert[] = [{ at: endAt, title: 'Recharge à 80 % (estimation)', body: `${d.station.name} : débranchez pour libérer la place.` }];
    if (tariff.idle) {
      const idleAt = endAt + tariff.idle.afterMin * 60_000;
      alerts.push({ at: idleAt - 5 * 60_000, title: 'Occupation facturée dans 5 min', body: `${d.operatorName} facture l’occupation après la charge : libérez la place avant ${clock(idleAt)}.` });
    }
    if (tariff.perMinLater) {
      alerts.push({ at: t0 + (tariff.perMinLater.afterMin - 5) * 60_000, title: 'Le prix à la minute augmente dans 5 min', body: `Au-delà de ${tariff.perMinLater.afterMin} min de charge chez ${d.operatorName}.` });
    }
    const next = update({ chargeStartedAt: t0 });
    const ids = await scheduleAlerts(alerts);
    if (next && ids.length) {
      const withIds = { ...next, alertIds: ids };
      store.setDirect(withIds);
      setD(withIds);
    }
  }

  function finish() {
    if (!d) return;
    cancelAlerts(d.alertIds);
    update({ endedAt: Date.now(), alertIds: [] });
  }

  async function reportDown() {
    if (!d) return;
    setMsg(null);
    if (d.station.id !== 'inconnue') sendCheckin({ stationId: d.station.id, ok: false });
    if (!apiEnabled() || d.station.lat == null || d.station.lon == null) {
      setMsg('Signalement enregistré sur ce téléphone. Prévenez aussi l’opérateur : son numéro figure sur la borne.');
      return;
    }
    try {
      await postReport('borne_hs', { lat: d.station.lat, lon: d.station.lon });
      setMsg('Merci : la borne est signalée hors service aux autres conducteurs pendant 24 h.');
    } catch {
      setMsg('Signalement impossible pour le moment (réseau). Réessayez plus tard.');
    }
  }

  async function save() {
    if (!d || !est) return;
    const ended = d.endedAt ?? Date.now();
    const kWh = parseEuros(kwhIn);
    const pricePaid = parseEuros(paid);
    const preauth = parseEuros(preauthIn);
    const base = recordOf(d, ended);
    const r: ChargeRecord = { ...base, kWh: kWh ?? base.kWh, kWhEstimated: kWh == null, pricePaid, ok };
    await addRecord(r);
    if (ok != null && d.station.id !== 'inconnue') {
      sendCheckin({ stationId: d.station.id, ok, ...(pricePaid != null ? { pricePaid } : {}), ...(kWh != null ? { kWh } : {}), ...(preauth != null ? { preauth } : {}) });
    }
    store.setPlan(null);
    update(null);
    setSaved(r);
  }

  if (saved) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card} accessibilityLabel="Reçu">
          <Text style={styles.cardTitle} accessibilityRole="header">Reçu enregistré</Text>
          <Row k="Borne" v={saved.stationName} />
          {saved.pdcId ? <Row k="Point" v={`…${saved.pdcId.slice(-4)}`} /> : null}
          <Row k="Payé à" v={saved.operatorName} />
          <Row k="Méthode" v={METHOD_LABEL[saved.method]} />
          <Row k="Durée" v={durationLabel((saved.endedAt - saved.startedAt) / 60_000)} />
          <Row k={saved.kWhEstimated ? 'Énergie (estimée)' : 'Énergie'} v={saved.kWh != null ? `${saved.kWh.toLocaleString('fr-FR')} kWh` : '—'} />
          <Row k="Montant payé" v={saved.pricePaid != null ? euros(Math.round(saved.pricePaid * 100)) : 'Non renseigné'} strong />
          <Text style={styles.mutedLeft}>Gardé uniquement sur ce téléphone. Le justificatif officiel vient de {saved.operatorName} (e-mail, ticket ou page de paiement).</Text>
        </View>
        <Button label="Voir l’historique" onPress={() => router.replace('/historique')} />
        <Button label="Retour à la carte" variant="light" onPress={() => router.replace('/')} />
      </ScrollView>
    );
  }

  if (d === undefined) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.charge} />
      </View>
    );
  }
  if (!d || !est || !input) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.title}>Aucune recharge en cours</Text>
        <Button label="Historique des recharges" variant="light" onPress={() => router.replace('/historique')} style={{ alignSelf: 'stretch' }} />
        <Button label="Retour à la carte" variant="light" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  const reader = !d.url;
  const reopen = () => (Platform.OS === 'web' ? window.open(d.url, '_blank', 'noopener,noreferrer') : WebBrowser.openBrowserAsync(d.url));
  const tel = d.station.tel ? () => Linking.openURL(`tel:${d.station.tel!.replace(/[^+\d]/g, '')}`) : null;
  const elapsedMs = d.chargeStartedAt ? (d.endedAt ?? now) - d.chargeStartedAt : 0;
  const prog = progressAt(input, elapsedMs / 60_000);
  const endAt = d.chargeStartedAt ? d.chargeStartedAt + est.minutes * 60_000 : 0;
  const idleAt = tariff?.idle && endAt ? endAt + tariff.idle.afterMin * 60_000 : null;
  const span = Math.max(1, est.toSoc - est.fromSoc);
  const pct = Math.min(1, Math.max(0, (prog.soc - est.fromSoc) / span));
  const pointText = d.plan?.pdcId ? ` · point …\u2060${d.plan.pdcId.slice(-4)}` : '';

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.headRow}>
        <Button label="Carte" variant="ghost" onPress={() => router.replace('/')} style={styles.back} />
        <Text style={styles.station} numberOfLines={2}>
          {d.station.name}
          {pointText}
        </Text>
      </View>

      {!d.chargeStartedAt && !help ? (
        <>
          <View style={styles.ring}>
            <Text style={styles.stateBig} accessibilityRole="header">
              {d.plan?.method === 'badge' ? 'Passez votre badge sur la borne' : d.plan?.method === 'account' ? `Démarrage avec votre compte ${d.operatorName}` : reader ? 'Payez sur le lecteur de la borne' : `Paiement chez ${d.operatorName}`}
            </Text>
            <Text style={styles.muted}>
              {d.plan?.method === 'badge'
                ? 'Suivez l’écran de la borne, puis branchez. Branché suit la recharge ici.'
                : d.plan?.method === 'account'
                  ? `Lancez la charge sur la page de ${d.operatorName}, branchez si ce n’est pas déjà fait, puis revenez ici.`
                  : reader
                ? `Suivez l’écran de la borne : carte bancaire${d.plan?.pdcId ? `, point …${d.plan.pdcId.slice(-4)}` : ''}, puis branchement. Branché suit la recharge ici.`
                : `Finalisez le paiement sur la page de ${d.operatorName}, branchez si ce n’est pas déjà fait, puis revenez ici.`}
            </Text>
          </View>
          {!reader && d.plan?.pdcId && (d.plan.method === 'operator-link' || d.plan.method === 'account') ? <CopyId id={d.plan.pdcId} dark /> : null}
          <Button label="La charge a démarré" onPress={started} hint="Lance le suivi en direct et les rappels de fin de charge" />
          <Button label="Ça ne démarre pas" variant="light" onPress={() => setHelp(true)} hint="Autre point, autre méthode, appeler l’opérateur" />
          {!reader ? <Button label={`Rouvrir la page ${d.operatorName}`} variant="ghost" onPress={reopen} /> : null}
        </>
      ) : null}

      {!d.chargeStartedAt && help ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">La charge ne démarre pas</Text>
            <Text style={styles.mutedLeft}>Vérifiez que le câble est bien enfoncé des deux côtés et que la voiture est déverrouillée. Si vous avez payé sans que la charge démarre, l’opérateur rembourse ou libère la pré-autorisation : gardez le reçu.</Text>
          </View>
          <Button label="Essayer un autre point" variant="light" onPress={() => router.replace({ pathname: '/recharger', params: { station: d.station.id, step: 'point' } })} />
          <Button label="Essayer une autre méthode" variant="light" onPress={() => router.replace({ pathname: '/recharger', params: { station: d.station.id } })} />
          {tel ? <Button label={`Appeler ${d.operatorName}`} variant="light" onPress={tel} hint={d.station.tel} /> : null}
          <Button label="Signaler la borne hors service" variant="light" onPress={reportDown} hint="Prévient les autres conducteurs, sans vous identifier" />
          {msg ? <Notice dark>{msg}</Notice> : null}
          <Button label="Finalement, la charge a démarré" variant="ghost" onPress={started} />
          <Button
            label="Abandonner"
            variant="ghost"
            onPress={() => {
              cancelAlerts(d.alertIds);
              update(null);
              router.replace('/');
            }}
          />
        </>
      ) : null}

      {charging ? (
        <>
          <View style={styles.ring} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: prog.soc }}>
            <Text style={styles.big}>{prog.soc} %</Text>
            <Text style={styles.state}>{prog.done ? `Objectif ${est.toSoc} % atteint (estimation)` : `En charge · fin à ${est.toSoc} % vers ${clock(endAt)}`}</Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <View style={styles.stats}>
              <Stat label="Énergie" value={`${prog.kWhBilled.toLocaleString('fr-FR')} kWh`} />
              <Stat label="Coût estimé" value={prog.cost != null ? euros(Math.round(prog.cost * 100)) : 'Prix inconnu'} />
              <Stat label="Écoulé" value={fmt(elapsedMs)} />
            </View>
            <Text style={styles.muted}>
              Estimation {d.plan?.vehicle ? `pour ${d.plan.vehicle.name}` : 'pour un véhicule moyen'} depuis {est.fromSoc} %, à {est.powerKw.toLocaleString('fr-FR')} kW. Le montant réel est celui de {d.operatorName}.
            </Text>
          </View>
          {prog.done ? <Notice tone="demo">Votre batterie devrait être à {est.toSoc} % : débranchez pour libérer la place{idleAt ? ' et éviter les frais d’occupation' : ''}.</Notice> : null}
          {idleAt ? (
            <Notice tone="demo">
              Occupation facturée à partir de {clock(idleAt)} environ ({tariff!.idle!.perMin.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} €/min). Rappel 5 min avant.
            </Notice>
          ) : (
            <Notice dark>Pensez à libérer la place en fin de charge.</Notice>
          )}
          {d.alertIds?.length ? <Text style={styles.small}>Rappel programmé à la fin de charge{idleAt ? ' et avant les frais d’occupation' : ''}.</Text> : null}
          <Button label="J’ai terminé ma recharge" onPress={finish} />
          {!reader ? <Button label={`Rouvrir la page ${d.operatorName}`} variant="ghost" onPress={reopen} /> : null}
          {tel ? <Button label={`Problème ? Appeler ${d.operatorName}`} variant="ghost" onPress={tel} /> : null}
        </>
      ) : null}

      {d.endedAt ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">Recharge terminée</Text>
            {d.autoEnded ? <Text style={styles.mutedLeft}>Départ de la borne détecté : recharge terminée automatiquement à {clock(d.endedAt)}. Le reçu est déjà dans votre historique ; ajoutez le prix si vous le souhaitez.</Text> : null}
            <Row k="Durée" v={fmt(elapsedMs)} />
            <Row k="Énergie estimée" v={`${prog.kWhBilled.toLocaleString('fr-FR')} kWh`} />
            <Row k="Coût estimé" v={prog.cost != null ? euros(Math.round(prog.cost * 100)) : 'Prix inconnu'} />
          </View>

          <View style={styles.card}>
            <Text style={styles.label} nativeID="ok-label">Ça a marché ?</Text>
            <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabelledBy="ok-label">
              {[
                { v: true, l: 'Oui' },
                { v: false, l: 'Non' },
              ].map((c) => (
                <Pressable
                  key={c.l}
                  role="radio"
                  aria-checked={ok === c.v}
                  accessibilityState={{ checked: ok === c.v }}
                  accessibilityLabel={c.l}
                  onPress={() => setOk(c.v)}
                  style={[styles.choice, ok === c.v && styles.choiceOn]}
                >
                  <Text style={[styles.choiceText, ok === c.v && { color: colors.nightBg }]}>{c.l}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.small}>Votre réponse aide les autres conducteurs (fiabilité de la borne). Envoyée sans identifiant, seulement si vous répondez.</Text>

            <Text style={styles.label} nativeID="paid-label">Combien avez-vous payé ? (facultatif)</Text>
            <TextInput
              value={paid}
              onChangeText={setPaid}
              placeholder="ex. 12,40"
              placeholderTextColor={colors.nightMuted}
              keyboardType="decimal-pad"
              aria-label="Montant payé en euros"
              accessibilityLabelledBy="paid-label"
              style={styles.input}
            />
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails((x) => !x)} style={styles.link}>
              <Text style={styles.linkText}>{details ? 'Moins de détails' : 'Plus de détails (kWh du ticket, montant bloqué)'}</Text>
            </Pressable>
            {details ? (
              <>
                <TextInput value={kwhIn} onChangeText={setKwhIn} placeholder={`kWh affichés (estimé : ${prog.kWhBilled.toLocaleString('fr-FR')})`} placeholderTextColor={colors.nightMuted} keyboardType="decimal-pad" aria-label="kWh affichés par la borne" style={styles.input} />
                <TextInput value={preauthIn} onChangeText={setPreauthIn} placeholder="Montant bloqué (pré-autorisation), en €" placeholderTextColor={colors.nightMuted} keyboardType="decimal-pad" aria-label="Montant de pré-autorisation en euros" style={styles.input} />
              </>
            ) : null}
          </View>
          <Button label="Enregistrer le reçu" onPress={save} hint="Ajoute la recharge à votre historique, sur ce téléphone" />
          <Button label="Reprendre la recharge" variant="ghost" onPress={() => update({ endedAt: null, autoEnded: false })} />
        </>
      ) : null}
    </ScrollView>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowK, strong && styles.strong]}>{k}</Text>
      <Text style={[styles.rowV, strong && styles.strong]} numberOfLines={2}>
        {v}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.nightBg },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 16 },
  body: { paddingHorizontal: 16, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: MIN_TOUCH, paddingHorizontal: 14 },
  title: { fontFamily: fonts.display, fontSize: 22, color: '#F2F6F4' },
  station: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.nightMuted },
  ring: { alignItems: 'center', gap: 10, paddingVertical: 24, paddingHorizontal: 14, borderRadius: radius.xl, backgroundColor: colors.nightCard },
  big: { fontFamily: fonts.display, fontSize: 52, color: '#F2F6F4' },
  stateBig: { fontFamily: fonts.display, fontSize: 22, color: '#F2F6F4', textAlign: 'center' },
  state: { fontFamily: fonts.bold, fontSize: 16, color: colors.charge, textAlign: 'center' },
  muted: { fontFamily: fonts.medium, fontSize: 14, color: colors.nightMuted, lineHeight: 20, textAlign: 'center' },
  mutedLeft: { fontFamily: fonts.medium, fontSize: 14, color: colors.nightMuted, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.nightMuted },
  bar: { width: '90%', height: 8, borderRadius: 4, backgroundColor: '#24342F', overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.charge },
  stats: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  stat: { flex: 1, backgroundColor: colors.nightBg, borderRadius: radius.md, padding: 10, gap: 2 },
  statLabel: { fontFamily: fonts.semibold, fontSize: 11, color: colors.nightMuted },
  statValue: { fontFamily: fonts.display, fontSize: 16, color: '#F2F6F4' },
  card: { backgroundColor: colors.nightCard, borderRadius: radius.lg, padding: 16, gap: 10 },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: '#F2F6F4' },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: '#F2F6F4' },
  choices: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, minHeight: 52, borderRadius: radius.md, borderWidth: 2, borderColor: colors.nightMuted, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: colors.charge, borderColor: colors.charge },
  choiceText: { fontFamily: fonts.bold, fontSize: 17, color: '#F2F6F4' },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: '#3A4A45', paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 16, color: '#F2F6F4', backgroundColor: colors.nightBg },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.charge },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowK: { fontFamily: fonts.medium, fontSize: 15, color: colors.nightMuted },
  rowV: { flex: 1, textAlign: 'right', fontFamily: fonts.semibold, fontSize: 15, color: '#F2F6F4' },
  strong: { color: '#F2F6F4', fontFamily: fonts.bold, fontSize: 17 },
});
