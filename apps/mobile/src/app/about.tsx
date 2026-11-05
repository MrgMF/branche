import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { LEGAL } from '../lib/config';
import { loadMeta, type Meta } from '../lib/stations';
import { colors, fonts, MIN_TOUCH } from '../theme';

export default function About() {
  const insets = useSafeAreaInsets();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    loadMeta().then(setMeta).catch(() => undefined);
  }, []);

  const links = [
    { label: 'Conditions générales d’utilisation', url: LEGAL.cgu },
    { label: 'Politique de confidentialité', url: LEGAL.confidentialite },
    { label: 'Mentions légales', url: LEGAL.mentions },
  ];

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.h1} accessibilityRole="header">Branché</Text>
      <Text style={styles.p}>Toutes les bornes de recharge publiques, une seule app. Version 1.0.</Text>

      <View style={styles.card}>
        <Text style={styles.h2}>Données</Text>
        <Text style={styles.p}>
          Bornes : base nationale IRVE (data.gouv.fr), Licence Ouverte 2.0.
          {meta ? ` ${meta.stations.toLocaleString('fr-FR')} stations et ${meta.pdc.toLocaleString('fr-FR')} points de charge, mis à jour le ${new Date(meta.generatedAt).toLocaleDateString('fr-FR')}.` : ''}
        </Text>
        <Text style={styles.p}>Carte : © contributeurs OpenStreetMap, tuiles OpenFreeMap, rendu MapLibre.</Text>
        <Text style={styles.p}>La disponibilité en temps réel n’est pas encore garantie : vérifiez sur place.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Votre position</Text>
        <Text style={styles.p}>Elle sert uniquement à trier les bornes sur votre téléphone. Elle n’est jamais envoyée à nos serveurs.</Text>
      </View>

      {links.map((l) => (
        <Pressable key={l.url} accessibilityRole="link" onPress={() => Linking.openURL(l.url)} style={styles.link}>
          <Text style={styles.linkText}>{l.label}</Text>
        </Pressable>
      ))}
      <Button label="Retour à la carte" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 14, backgroundColor: colors.surface, flexGrow: 1 },
  h1: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  h2: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkMuted },
  card: { backgroundColor: colors.surfaceAlt, borderRadius: 16, padding: 16, gap: 6 },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  linkText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.accent },
});
