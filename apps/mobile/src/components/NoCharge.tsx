// État vide unique « Aucune recharge en cours » : identique dans « Ma recharge » et dans le suivi (/recharge).
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { Button } from './ui';
import { useT } from '../i18n';
import { colors, fonts } from '../theme';

export function NoCharge() {
  const t = useT();
  const M = t.maRecharge;
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name="bolt" size={34} color={colors.accentPressed} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {M.emptyTitle}
      </Text>
      <Text style={[styles.p, { textAlign: 'center' }]}>{M.emptyBody}</Text>
      <Button label={t.common.findStation} onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      <Button label={t.common.scanQr} variant="secondary" onPress={() => router.push('/payer')} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, paddingVertical: 24, paddingHorizontal: 8 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, textAlign: 'left' },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkMuted },
});
