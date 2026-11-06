// « Mes comptes de recharge » et « Mes badges » : l'utilisateur se connecte sur le SITE OFFICIEL de l'opérateur,
// ouvert dans le navigateur intégré de Branché (la session reste dans ce navigateur). Branché ne voit, ne stocke ni ne
// transmet aucun identifiant, mot de passe, numéro de badge ou carte : il retient seulement « compte X connecté le … ».
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice } from '../components/ui';
import { BADGES, forgetAccount, loadWallet, markConnected, setBadges, type Wallet } from '../lib/accounts';
import { loadPortals, type Portals } from '../lib/portals';
import type { Operator } from '../lib/qr';
import { loadOperators } from '../lib/stations';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { ScreenHeader } from '../components/Screen';
import { useT } from '../i18n';
import { dateLong } from '../i18n/format';

interface Site {
  key: string;
  name: string;
  url: string;
  /** Démarrage d'une charge depuis le site connu. */
  canStart: boolean;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '');
const day = dateLong;

export default function Comptes() {
  const t = useT();
  const A = t.accounts;
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ op?: string }>();
  const [portals, setPortals] = useState<Portals>({});
  const [ops, setOps] = useState<Operator[]>([]);
  const [wallet, setWallet] = useState<Wallet>({ accounts: [], badges: [] });
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<Site | null>(null);
  const [other, setOther] = useState('');

  useEffect(() => {
    loadPortals().then(setPortals);
    loadOperators().then(setOps);
    loadWallet().then(setWallet);
  }, []);

  // Sites officiels : portails publiés, sinon domaine déclaré par l'opérateur dans la base IRVE
  const sites = useMemo(() => {
    const out = new Map<string, Site>();
    for (const [key, p] of Object.entries(portals)) if (p.webPortal) out.set(key, { key, name: p.name, url: p.webPortal, canStart: !!p.webStart?.url });
    for (const o of [...ops].sort((a, b) => (b.stations ?? 0) - (a.stations ?? 0)))
      if (!out.has(o.key) && o.domains[0] && !o.domains[0].includes(':')) out.set(o.key, { key: o.key, name: o.names[0], url: `https://${o.domains[0]}`, canStart: false });
    return [...out.values()];
  }, [portals, ops]);

  const shown = useMemo(() => {
    const f = fold(q.trim());
    const list = f ? sites.filter((s) => fold(s.name).includes(f)) : sites.slice(0, 12);
    const first = params.op ? sites.find((s) => s.key === params.op) : undefined;
    return first ? [first, ...list.filter((s) => s.key !== first.key)] : list;
  }, [sites, q, params.op]);

  async function connect(s: Site) {
    setPending(s);
    if (Platform.OS === 'web') window.open(s.url, '_blank', 'noopener,noreferrer');
    else await WebBrowser.openBrowserAsync(s.url, { showTitle: true, enableBarCollapsing: true }).catch(() => undefined);
  }

  const connected = (key: string) => wallet.accounts.find((a) => a.operatorKey === key);
  const toggleBadge = async (b: string) => setWallet(await setBadges(wallet.badges.includes(b) ? wallet.badges.filter((x) => x !== b) : [...wallet.badges, b]));

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={t.titles.comptes} />
      <Text style={styles.p}>{A.intro}</Text>
      <Notice>{A.privacy}</Notice>

      {pending ? (
        <View style={styles.confirm} accessibilityLiveRegion="polite">
          <Text style={styles.cardTitle}>{A.connectedQ(pending.name)}</Text>
          <Text style={styles.p}>{A.connectedBody}</Text>
          <Button
            label={A.yesConnected}
            onPress={async () => {
              setWallet(await markConnected(pending.key, pending.name));
              setPending(null);
            }}
          />
          <Button label={A.notNow} variant="ghost" onPress={() => setPending(null)} />
        </View>
      ) : null}

      <Text style={styles.h2} accessibilityRole="header">
        {A.operators}
      </Text>
      <TextInput value={q} onChangeText={setQ} placeholder={A.searchPh} placeholderTextColor="#6B7773" aria-label={A.searchA11y} style={styles.input} autoCorrect={false} />
      {!sites.length ? <Text style={styles.p}>{A.listDown}</Text> : !shown.length ? <Text style={styles.p}>{A.noMatch}</Text> : null}
      {shown.map((s) => {
        const c = connected(s.key);
        return (
          <View key={s.key} style={[styles.item, c && styles.itemOn]}>
            <View style={{ minWidth: 0, gap: 2 }}>
              <Text style={styles.itemTitle}>{s.name}</Text>
              <Text style={styles.small} numberOfLines={2}>
                {c ? A.connectedOn(day(c.connectedAt)) : s.url.replace(/^https:\/\//, '')}
                {s.canStart ? A.canStart : ''}
              </Text>
            </View>
            {/* Action sous le nom (jamais coupée lettre par lettre quand le texte est agrandi) */}
            {c ? (
              <Pressable accessibilityRole="button" accessibilityLabel={A.forgetA11y(s.name)} onPress={async () => setWallet(await forgetAccount(s.key))} style={styles.action}>
                <Text style={styles.linkDanger}>{A.forget}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={A.connectA11y(s.name)} onPress={() => connect(s)} style={styles.action}>
                <Text style={styles.linkText}>{A.connect}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {!q && sites.length > shown.length ? <Text style={styles.small}>{A.countHint(sites.length)}</Text> : null}

      <Text style={styles.h2} accessibilityRole="header">
        {A.badges}
      </Text>
      <Text style={styles.p}>{A.badgesIntro}</Text>
      <View style={styles.chips}>
        {[...BADGES, ...wallet.badges.filter((b) => !BADGES.includes(b))].map((b) => {
          const on = wallet.badges.includes(b);
          return (
            <Pressable key={b} role="checkbox" aria-checked={on} accessibilityState={{ checked: on }} accessibilityLabel={b} onPress={() => toggleBadge(b)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: colors.onAccent }]}>{b}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.row}>
        <TextInput value={other} onChangeText={setOther} placeholder={A.otherPh} placeholderTextColor="#6B7773" aria-label={A.otherA11y} style={[styles.input, { flexGrow: 1, flexBasis: 180, minWidth: 0 }]} />
        <Button
          label={A.add}
          variant="ghost"
          disabled={!other.trim()}
          onPress={async () => {
            setWallet(await setBadges([...wallet.badges, other]));
            setOther('');
          }}
          style={{ minHeight: 50, paddingHorizontal: 14, flexGrow: 1, flexShrink: 0 }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 16, gap: 12, maxWidth: 600, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: MIN_TOUCH, paddingHorizontal: 14 },
  h1: { flex: 1, fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  h2: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, marginTop: 6 },
  p: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  confirm: { borderWidth: 2, borderColor: colors.accent, borderRadius: radius.lg, padding: 14, gap: 8 },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.inputBorder, paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
  item: { gap: 4, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  itemOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  itemTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  action: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start', paddingVertical: 4 },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  linkDanger: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.inputBorder, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  // 320 px / texte agrandi : le bouton passe sous le champ plutôt que de rogner son invite.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
