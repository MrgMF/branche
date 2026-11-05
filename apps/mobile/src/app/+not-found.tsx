import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { colors, fonts } from '../theme';

export default function NotFound() {
  return (
    <View style={styles.root}>
      <Text style={styles.h1} accessibilityRole="header">Page introuvable</Text>
      <Text style={styles.p}>Cette adresse n’existe pas dans Branché.</Text>
      <Button label="Retour à la carte" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.surface },
  h1: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 16, color: colors.inkMuted },
});
