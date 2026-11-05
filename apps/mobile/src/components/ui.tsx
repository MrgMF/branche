import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
        v === 'secondary' && { borderWidth: 2, borderColor: colors.ink, backgroundColor: pressed ? colors.surfaceAlt : colors.surface },
        v === 'ghost' && { backgroundColor: pressed ? colors.border : colors.surfaceAlt },
        v === 'light' && { backgroundColor: pressed ? colors.border : colors.surface },
        off && { opacity: 0.45 },
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={v === 'primary' ? '#fff' : colors.ink} />
      ) : (
        <View style={styles.row}>
          {props.icon}
          <Text style={[styles.label, { color: v === 'primary' ? '#FFFFFF' : colors.ink }]}>{props.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Chip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: props.active }}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={4}
      style={[styles.chip, props.active ? styles.chipOn : styles.chipOff]}
    >
      <Text style={[styles.chipText, { color: props.active ? '#FFFFFF' : colors.ink }]}>{props.label}</Text>
    </Pressable>
  );
}

export function Notice(props: { children: ReactNode; tone?: 'demo' | 'info' | 'error'; dark?: boolean }) {
  const tone = props.tone ?? 'info';
  const bg = tone === 'demo' ? colors.warnSoft : tone === 'error' ? '#FDECEC' : colors.accentSoft;
  const fg = tone === 'demo' ? '#7A3E06' : tone === 'error' ? colors.danger : colors.accentPressed;
  return (
    <View accessibilityRole="text" style={[styles.notice, { backgroundColor: bg }]}>
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

export function Stat({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <View style={[styles.stat, dark && { backgroundColor: colors.nightCard }]}>
      <Text style={[styles.statLabel, dark && { color: colors.nightMuted }]}>{label}</Text>
      <Text style={[styles.statValue, dark && { color: '#F2F6F4' }]} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.bold, fontSize: 17 },
  chip: { minHeight: MIN_TOUCH - 8, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink },
  chipOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#C9D3D0' },
  chipText: { fontFamily: fonts.semibold, fontSize: 13 },
  notice: { borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12 },
  noticeText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  tag: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 9 },
  tagText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  stat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12, gap: 2 },
  statLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted },
  statValue: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
});
