import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';

export default function NotFound() {
  const t = useT();
  return (
    <View style={styles.root}>
      <Text style={styles.h1} accessibilityRole="header">{t.titles.notFound}</Text>
      <Text style={styles.p}>{t.notFound.body}</Text>
      <Button label={t.common.backToMap} onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: colors.surface },
  h1: { fontFamily: fonts.display, fontSize: 26, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 16, color: colors.inkMuted },
});
