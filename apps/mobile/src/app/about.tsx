import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/Screen';
import { useT } from '../i18n';
import { dateNum, num } from '../i18n/format';
import { LEGAL } from '../lib/config';
import { loadMeta, type Meta } from '../lib/stations';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

export default function About() {
  const t = useT();
  const A = t.about;
  const insets = useSafeAreaInsets();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    loadMeta().then(setMeta).catch(() => undefined);
  }, []);

  // Textes juridiques : en français uniquement (la version française fait foi).
  const links = [
    { label: A.cgu, url: LEGAL.cgu },
    { label: A.privacy, url: LEGAL.confidentialite },
    { label: A.mentions, url: LEGAL.mentions },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <ScreenHeader title={t.titles.about} />
      <View style={styles.hero}>
        <Text style={styles.brand}>{t.common.brand}</Text>
        <Text style={styles.p}>{A.tagline}</Text>
        <Text style={styles.small}>{A.version(Constants.expoConfig?.version ?? '1.0.0')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2} accessibilityRole="header">
          {A.data}
        </Text>
        <Text style={styles.p}>
          {A.stations}
          {meta ? A.meta(num(meta.stations, 0), num(meta.pdc, 0), dateNum(Date.parse(meta.generatedAt))) : ''}
        </Text>
        <Text style={styles.p}>{A.attributions}</Text>
        <Text style={styles.p}>{A.realtime}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2} accessibilityRole="header">
          {A.position}
        </Text>
        <Text style={styles.p}>{A.positionBody}</Text>
      </View>

      <View style={{ gap: 2 }}>
        <Text style={styles.h2} accessibilityRole="header">
          {A.legal}
        </Text>
        <Text style={styles.small}>{A.legalNote}</Text>
        {links.map((l) => (
          <Pressable key={l.url} accessibilityRole="link" accessibilityLanguage="fr-FR" onPress={() => Linking.openURL(l.url)} style={({ pressed }) => [styles.link, pressed && { backgroundColor: colors.surfaceAlt }]}>
            <Text style={styles.linkText}>{l.label}</Text>
            <Icon name="chevron" size={18} color={colors.accent} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 16, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  hero: { gap: 4 },
  brand: { fontFamily: fonts.display, fontSize: 28, color: colors.accent },
  h2: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkMuted },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
  card: { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: 16, gap: 6 },
  link: { minHeight: MIN_TOUCH + 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  linkText: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.accent },
});
