// En-tête commun des écrans : retour (bouton + geste natif + Échap sur le web + bouton retour Android), titre, sous-titre.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { colors, fonts, MIN_TOUCH } from '../theme';
import { Icon } from './Icon';

export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Échap (web) et retour matériel (Android, si `onBack` personnalisé) tant que l'écran est au premier plan. */
export function useBackKeys(onBack: () => void, custom: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') {
        const onKey = (e: KeyboardEvent) => {
          if (e.key !== 'Escape' || e.defaultPrevented) return;
          e.preventDefault();
          onBack();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }
      if (!custom) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onBack();
        return true;
      });
      return () => sub.remove();
    }, [onBack, custom]),
  );
}

export function ScreenHeader(props: { title: string; kicker?: string; sub?: string; onBack?: () => void; dark?: boolean; right?: ReactNode; titleLines?: number }) {
  const t = useT();
  const back = props.onBack ?? goBack;
  useBackKeys(back, !!props.onBack);
  const ink = props.dark ? '#F2F6F4' : colors.ink;
  return (
    <View style={styles.head}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.common.backA11y}
        testID="back"
        onPress={back}
        hitSlop={4}
        style={({ pressed }) => [styles.back, { backgroundColor: props.dark ? colors.nightCard : colors.surfaceAlt }, pressed && { opacity: 0.7 }]}
      >
        <Icon name="back" size={24} color={ink} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        {props.kicker ? <Text style={[styles.kicker, props.dark && { color: colors.charge }]}>{props.kicker}</Text> : null}
        <Text style={[styles.title, { color: ink }]} numberOfLines={props.titleLines ?? 2} accessibilityRole="header">
          {props.title}
        </Text>
        {props.sub ? (
          <Text style={[styles.sub, props.dark && { color: colors.nightMuted }]} numberOfLines={2}>
            {props.sub}
          </Text>
        ) : null}
      </View>
      {props.right}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  back: { width: MIN_TOUCH + 4, height: MIN_TOUCH + 4, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentPressed, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28 },
  sub: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
});
