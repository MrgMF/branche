// Premier lancement : 3 écrans maximum, sautables. Aucun compte ; la permission de position est expliquée avant d'être demandée.
import * as Location from 'expo-location';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { Button } from './ui';

const SLIDES = [
  {
    title: 'Toutes les bornes, une seule appli',
    body: 'Branché affiche les bornes publiques de France (base nationale IRVE), le prix avant de payer et la marche à suivre propre à chaque borne.',
    points: ['Prix analysé et estimation pour votre voiture', 'Mode d’emploi en 3 étapes à la borne', 'Suivi de la charge et reçu'],
  },
  {
    title: 'Aucun compte, aucun mot de passe',
    body: 'Vous payez directement l’opérateur : carte bancaire sur la borne, ou sa page officielle dont Branché vérifie l’adresse (anti-faux QR code).',
    points: ['Branché ne voit jamais votre carte', 'Historique et véhicule gardés sur ce téléphone', 'Rien à créer, rien à retenir'],
  },
  {
    title: 'Votre position, pour vous reconnaître à la borne',
    body: 'Elle sert à trouver la borne la plus proche et à afficher « Vous êtes à… » quand vous arrivez. Elle reste sur votre téléphone, sauf si vous demandez un itinéraire ou faites un signalement.',
    points: ['Vous pouvez refuser : la carte reste utilisable', 'Modifiable à tout moment dans les réglages'],
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;

  async function allow() {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      /* refus ou indisponible : l'app fonctionne sans */
    }
    onDone();
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.top}>
        <Text style={styles.brand}>Branché</Text>
        <Button label="Passer" variant="ghost" onPress={onDone} style={styles.skip} hint="Ignorer la présentation" />
      </View>
      <View style={styles.content} accessibilityLiveRegion="polite">
        <View style={styles.dots} accessibilityLabel={`Écran ${i + 1} sur ${SLIDES.length}`}>
          {SLIDES.map((_, k) => (
            <View key={k} style={[styles.dot, k === i && styles.dotOn]} />
          ))}
        </View>
        <Text style={styles.h1} accessibilityRole="header">
          {s.title}
        </Text>
        <Text style={styles.p}>{s.body}</Text>
        <View style={styles.card}>
          {s.points.map((p) => (
            <View key={p} style={styles.pointRow}>
              <View style={styles.tick} />
              <Text style={styles.point}>{p}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        {last ? (
          <>
            <Button label="Autoriser la position" onPress={allow} hint={Platform.OS === 'web' ? 'Le navigateur vous demandera votre accord' : 'Le téléphone vous demandera votre accord'} />
            <Button label="Plus tard" variant="ghost" onPress={onDone} />
          </>
        ) : (
          <>
            <Button label="Suivant" onPress={() => setI(i + 1)} />
            {i > 0 ? <Button label="Précédent" variant="ghost" onPress={() => setI(i - 1)} /> : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 20, maxWidth: 600, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: fonts.display, fontSize: 22, color: colors.accent },
  skip: { minHeight: MIN_TOUCH, paddingHorizontal: 16 },
  content: { flex: 1, justifyContent: 'center', gap: 16 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 24, backgroundColor: colors.accent },
  h1: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.inkMuted },
  card: { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: 16, gap: 10 },
  pointRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  tick: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  point: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  actions: { gap: 10 },
});
