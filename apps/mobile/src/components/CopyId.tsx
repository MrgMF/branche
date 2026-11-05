// Identifiant du point à recopier sur la page de l'opérateur, avec bouton « Copier ».
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

export function CopyId({ id, dark }: { id: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={[styles.box, dark && styles.dark]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.label, dark && { color: colors.nightMuted }]}>Identifiant du point à saisir</Text>
        <Text style={[styles.id, dark && { color: '#F2F6F4' }]} selectable>
          {id}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Identifiant copié' : `Copier l’identifiant ${id}`}
        onPress={async () => {
          await Clipboard.setStringAsync(id).catch(() => undefined);
          setCopied(true);
        }}
        style={styles.btn}
      >
        <Text style={styles.btnText}>{copied ? 'Copié' : 'Copier'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  dark: { backgroundColor: colors.nightBg },
  label: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted },
  id: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  btn: { minHeight: MIN_TOUCH, minWidth: 88, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnText: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
});
