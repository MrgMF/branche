import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiConfig } from '../lib/api';
import { navigationLinks, startCharge } from '../lib/charge';
import { euros, km, kw, minutes, PAY_LABEL, PLUG_LABEL } from '../lib/format';
import { getCommunity, type Community } from '../lib/community';
import { displayName, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { TariffLines } from './Pricing';
import { Button, Notice, Stat, Tag } from './ui';

export function StationDetail(props: {
  station: Station;
  distance: number | null;
  api: ApiConfig | null;
  apiError: boolean;
  apiLoading: boolean;
  operatorName: string;
  onRoute: () => void;
  onClose: () => void;
}) {
  const { station: s, distance, api } = props;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payAtStation = s.pay.filter((p) => p !== 'badge').map((p) => PAY_LABEL[p]);
  const reserved = s.acc === 'reserve';
  const opName = props.operatorName;
  const [community, setCommunity] = useState<Community | null>(null);
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
      setErr(e instanceof Error ? e.message : 'Impossible de démarrer le paiement.');
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
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer la fiche" onPress={props.onClose} style={styles.close} hitSlop={8}>
          <Text style={styles.closeX}>×</Text>
        </Pressable>
      </View>

      <View style={styles.stats}>
        <Stat label="Puissance max" value={kw(s.kw)} />
        <Stat label="Points" value={String(s.p)} />
        <Stat label="Accès" value={reserved ? 'Réservé' : 'Libre'} />
      </View>

      <View style={styles.tags}>
        {s.c.map((c) => (
          <Tag key={c}>{PLUG_LABEL[c]}</Tag>
        ))}
        {s.h ? <Tag>{s.h === '24/7' ? 'Ouvert 24h/24' : s.h.length > 32 ? 'Horaires restreints' : s.h}</Tag> : null}
        {s.free ? <Tag>Gratuit</Tag> : null}
      </View>

      {reserved ? <Notice tone="demo">Accès réservé (clients, résidents ou abonnés) : vérifiez sur place avant de vous y rendre.</Notice> : null}
      {s.a ? <Text style={styles.addr}>{s.a}</Text> : null}

      <View style={styles.payCard}>
        <Text style={styles.payTitle}>Recharger à cette borne</Text>
        <Text style={styles.payText}>Sans compte ni appli : choix du point, prix estimé pour votre voiture, puis paiement direct à {opName} (carte sur la borne ou page officielle vérifiée).</Text>
        <Button
          label="Recharger ici"
          onPress={() => {
            store.setCurrent(s);
            router.push({ pathname: '/recharger', params: { station: s.id } });
          }}
          hint="Choix du point de charge, prix avant de payer et mode d’emploi"
        />
        <Text style={styles.boxTitle}>Prix opérateur</Text>
        <TariffLines station={s} community={community} compact />
        {payAtStation.length ? <Text style={styles.small}>Moyens acceptés sur place : {payAtStation.join(' · ')}.</Text> : null}
      </View>

      <Button label="Itinéraire le plus rapide" variant="secondary" onPress={props.onRoute} hint="Calcule le trajet avec le trafic en temps réel et les perturbations" />
      <View style={styles.navRow}>
        {navigationLinks(s).map((l) => (
          <Button key={l.label} label={l.label} variant="ghost" style={{ flex: 1, minHeight: 44 }} onPress={() => Linking.openURL(l.url)} />
        ))}
      </View>

      {api ? (
        <View style={styles.demoBox}>
          <Text style={styles.boxTitle}>Paiement Branché (itinérance, en préparation)</Text>
          <Button label="Essayer en démo" variant="light" onPress={charge} loading={busy} hint="Paiement et borne simulés, aucun débit" style={styles.demoBtn} />
          <Text style={styles.small}>
            Démo : aucun débit. {euros(api.priceCentsPerKwh)}/kWh + {euros(api.feeCents)} de frais, pré-autorisation de {euros(api.preauthCents)}.
          </Text>
        </View>
      ) : props.apiLoading ? (
        <Text style={styles.small}>Connexion au service Branché…</Text>
      ) : null}
      {err ? <Notice tone="error">{err}</Notice> : null}

      {s.tel ? (
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${s.tel!.replace(/[^+\d]/g, '')}`)} style={styles.link}>
          <Text style={styles.linkText}>Appeler l’opérateur · {s.tel}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.small}>Source : base nationale IRVE{s.maj ? `, mise à jour opérateur du ${s.maj.split('-').reverse().join('/')}` : ''}. Disponibilité en temps réel non garantie.</Text>
    </View>
  );
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
  payCard: { borderWidth: 2, borderColor: colors.accent, borderRadius: radius.lg, padding: 14, gap: 10 },
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
