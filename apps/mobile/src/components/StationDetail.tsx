import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiConfig } from '../lib/api';
import { navigationLinks, startCharge } from '../lib/charge';
import { euros, km, kw, minutes, PAY_LABEL, PLUG_LABEL } from '../lib/format';
import { displayName, priceInfo, type Station } from '../lib/stations';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { Button, Notice, Stat, Tag } from './ui';

export function StationDetail(props: { station: Station; distance: number | null; api: ApiConfig | null; apiError: boolean; onClose: () => void }) {
  const { station: s, distance, api } = props;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payAtStation = s.pay.filter((p) => p !== 'badge').map((p) => PAY_LABEL[p]);
  const reserved = s.acc === 'reserve';
  const price = priceInfo(s);

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

      <View style={styles.box}>
        <Text style={styles.boxTitle}>Prix opérateur</Text>
        {price.url ? (
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(price.url!)} style={styles.inlineLink}>
            <Text style={styles.linkText}>{price.text}</Text>
          </Pressable>
        ) : (
          <Text style={styles.boxText}>{price.text}</Text>
        )}
        <Text style={[styles.boxTitle, { marginTop: 8 }]}>Payer directement à la borne</Text>
        <Text style={styles.boxText}>{payAtStation.length ? payAtStation.join(' · ') : 'Moyens de paiement non renseignés.'}</Text>
      </View>

      {api ? (
        <>
          <Button label="Charger ici avec Branché" onPress={charge} loading={busy} hint="Ouvre la page de paiement sécurisée" />
          {api.demo ? (
            <Notice tone="demo">
              Démo : paiement et borne simulés, aucun débit. Pré-autorisation de {euros(api.preauthCents)}, {euros(api.priceCentsPerKwh)}/kWh + {euros(api.feeCents)} de
              frais.
            </Notice>
          ) : (
            <Text style={styles.small}>
              Pré-autorisation de {euros(api.preauthCents)}, seul le montant réel est débité ({euros(api.priceCentsPerKwh)}/kWh + {euros(api.feeCents)} de frais).
            </Text>
          )}
        </>
      ) : (
        <Notice tone={props.apiError ? 'error' : 'info'}>
          {props.apiError
            ? 'Service de paiement momentanément indisponible. Vous pouvez payer directement à la borne.'
            : 'Paiement dans l’app bientôt disponible sur ce réseau. En attendant, payez directement à la borne.'}
        </Notice>
      )}
      {err ? <Notice tone="error">{err}</Notice> : null}

      <Text style={styles.navTitle}>Itinéraire</Text>
      <View style={styles.navRow}>
        {navigationLinks(s).map((l) => (
          <Button key={l.label} label={l.label} variant="secondary" style={{ flex: 1, minHeight: 48 }} onPress={() => Linking.openURL(l.url)} />
        ))}
      </View>
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
