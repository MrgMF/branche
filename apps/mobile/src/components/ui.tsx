import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'light';

export function Button(props: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = props.variant ?? 'primary';
  const off = props.disabled || props.loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      accessibilityState={{ disabled: !!off, busy: !!props.loading }}
      disabled={off}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.btn,
        v === 'primary' && { backgroundColor: pressed ? colors.accentPressed : colors.accent },
        v === 'secondary' && { borderWidth: 2, borderColor: colors.inputBorder, backgroundColor: pressed ? colors.surfaceAlt : colors.surface },
        v === 'ghost' && { backgroundColor: pressed ? colors.border : colors.surfaceAlt },
        v === 'light' && { backgroundColor: pressed ? colors.border : colors.surface },
        // Désactivé : texte inkMuted sur fond gris clair (>= 4,5:1), pas d'opacité.
        off && !props.loading && { backgroundColor: colors.disabledBg, borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed' },
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={v === 'primary' ? colors.onAccent : colors.ink} />
      ) : (
        <View style={styles.row}>
          {props.icon}
          <Text style={[styles.label, { color: off ? colors.disabledText : v === 'primary' ? colors.onAccent : colors.ink }]}>{props.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Chip(props: { label: string; a11y?: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      role="switch"
      aria-checked={props.active}
      accessibilityState={{ checked: props.active }}
      accessibilityLabel={props.a11y ?? props.label}
      onPress={props.onPress}
      style={[styles.chip, props.active ? styles.chipOn : styles.chipOff]}
    >
      <View style={styles.row}>
        {props.active ? (
          <Svg width={14} height={14} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
            <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={colors.onAccent} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : null}
        <Text style={[styles.chipText, { color: props.active ? colors.onAccent : colors.ink }]}>{props.label}</Text>
      </View>
    </Pressable>
  );
}

export function Notice(props: { children: ReactNode; tone?: 'demo' | 'info' | 'error'; dark?: boolean }) {
  const tone = props.tone ?? 'info';
  const err = tone === 'error';
  // Thème de nuit : carte sombre + texte clair (contraste AA) et liseré d'accent, au lieu d'une pastille claire éblouissante.
  const dark = props.dark;
  const bg = dark ? colors.nightCard : tone === 'demo' ? colors.warnSoft : err ? colors.dangerSoft : colors.accentSoft;
  const fg = dark
    ? err
      ? colors.nightDanger
      : tone === 'demo'
        ? colors.charge
        : colors.nightText
    : tone === 'demo'
      ? colors.warnText
      : err
        ? colors.danger
        : colors.accentPressed;
  const edge = dark ? (err ? colors.nightDanger : colors.charge) : null;
  return (
    <View
      accessibilityRole={err ? 'alert' : 'text'}
      accessibilityLiveRegion={err ? 'assertive' : undefined}
      {...(err ? ({ 'aria-live': 'assertive' } as object) : null)}
      style={[styles.notice, { backgroundColor: bg }, edge ? { borderLeftWidth: 3, borderLeftColor: edge } : null]}
    >
      <Text style={[styles.noticeText, { color: fg }]}>{props.children}</Text>
    </View>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{children}</Text>
    </View>
  );
}

/** `wrap` : texte agrandi, tuiles empilées — la valeur passe à la ligne au lieu d'être réduite ou tronquée. */
export function Stat({ label, value, dark, wrap }: { label: string; value: string; dark?: boolean; wrap?: boolean }) {
  return (
    <View style={[styles.stat, dark && { backgroundColor: colors.nightCard }, wrap && { flex: 0 }]}>
      <Text style={[styles.statLabel, dark && { color: colors.nightMuted }]}>{label}</Text>
      <Text style={[styles.statValue, dark && { color: colors.nightText }]} {...(wrap ? null : { adjustsFontSizeToFit: true, numberOfLines: 1 })}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.bold, fontSize: 17 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder },
  chipText: { fontFamily: fonts.semibold, fontSize: 13 },
  notice: { borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12 },
  noticeText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  tag: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 9 },
  tagText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  stat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12, gap: 2 },
  statLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted },
  statValue: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
});
