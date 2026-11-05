// Menu principal (façon Waze) : bouton sur la carte → panneau latéral avec toutes les sections de l'app.
// Échap (web), retour Android et toucher hors du panneau le ferment.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { loadHistory } from '../lib/history';
import { loadPrepared } from '../lib/prepared';
import { store } from '../lib/store';
import { loadVehicle } from '../lib/vehicle';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { Icon, type ShellIcon } from './Icon';

export type ChargeState = 'active' | 'prepared' | null;

/** État « Ma recharge » pour le badge : suivie en cours, sinon préparée. */
export async function chargeState(): Promise<ChargeState> {
  const d = await store.loadDirect();
  if (d && !d.endedAt) return 'active';
  if (d?.endedAt && d.autoEnded) return 'active';
  return (await loadPrepared()) ? 'prepared' : null;
}

export function MenuButton({ onPress, badge }: { onPress: () => void; badge: ChargeState }) {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.menu.openA11y}${badge ? `. ${t.menu.myCharge} : ${badge === 'active' ? t.menu.active : t.menu.prepared}` : ''}`}
      testID="menu"
      onPress={onPress}
      style={({ pressed }) => [styles.menuBtn, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      <Icon name="menu" size={26} />
      {badge ? <View style={[styles.dot, badge === 'prepared' && { backgroundColor: colors.busy }]} /> : null}
    </Pressable>
  );
}

interface Item {
  key: string;
  icon: ShellIcon;
  label: string;
  sub?: string;
  badge?: string;
  to: string | null;
}

export function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [charge, setCharge] = useState<ChargeState>(null);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const closeRef = useRef<{ focus?: () => void } | null>(null);

  useEffect(() => {
    if (!open) return;
    chargeState().then(setCharge);
    loadVehicle().then((v) => setVehicle(v?.name ?? null));
    loadHistory().then((l) => setCount(l.length));
    if (Platform.OS === 'web') setTimeout(() => closeRef.current?.focus?.(), 50);
    if (Platform.OS === 'web') {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  if (!open) return null;

  const items: Item[] = [
    { key: 'map', icon: 'map', label: t.menu.map, to: null },
    {
      key: 'charge',
      icon: 'bolt',
      label: t.menu.myCharge,
      sub: charge ? undefined : t.menu.noCharge,
      badge: charge === 'active' ? t.menu.active : charge === 'prepared' ? t.menu.prepared : undefined,
      to: charge === 'active' ? '/recharge' : '/ma-recharge',
    },
    { key: 'history', icon: 'receipt', label: t.menu.history, sub: t.menu.charges(count), to: '/historique' },
    { key: 'vehicle', icon: 'car', label: t.menu.vehicle, sub: vehicle ?? t.menu.noVehicle, to: '/vehicule' },
    { key: 'accounts', icon: 'card', label: t.menu.accounts, to: '/comptes' },
    { key: 'settings', icon: 'gear', label: t.menu.settings, to: '/reglages' },
    { key: 'about', icon: 'info', label: t.menu.about, to: '/about' },
  ];

  function go(to: string | null) {
    onClose();
    if (to) router.push(to as never);
  }

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]} testID="app-menu">
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t.menu.close} accessibilityRole="button" />
      <View
        style={[styles.panel, { width: Math.min(360, width * 0.88), paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}
        accessibilityViewIsModal
        role="dialog"
        aria-modal
        aria-label={t.menu.open}
      >
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>{t.common.brand}</Text>
            <Text style={styles.tagline}>{t.menu.tagline}</Text>
          </View>
          <Pressable ref={closeRef as never} accessibilityRole="button" accessibilityLabel={t.menu.close} onPress={onClose} style={styles.close}>
            <Text style={styles.closeX}>×</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingVertical: 4 }}>
          {items.map((it) => (
            <Pressable
              key={it.key}
              accessibilityRole={it.to ? 'link' : 'button'}
              accessibilityLabel={[it.label, it.badge, it.sub].filter(Boolean).join(', ')}
              testID={`menu-${it.key}`}
              onPress={() => go(it.to)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceAlt }]}
            >
              <View style={[styles.iconWrap, it.key === 'charge' && charge ? { backgroundColor: colors.accentSoft } : null]}>
                <Icon name={it.icon} size={22} color={it.key === 'charge' && charge ? colors.accentPressed : colors.ink} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.label} numberOfLines={1}>
                  {it.label}
                </Text>
                {it.sub ? (
                  <Text style={styles.sub} numberOfLines={1}>
                    {it.sub}
                  </Text>
                ) : null}
              </View>
              {it.badge ? (
                <View style={[styles.badge, charge === 'prepared' && { backgroundColor: colors.warnSoft }]}>
                  <Text style={[styles.badgeText, charge === 'prepared' && { color: '#7A3E06' }]}>{it.badge}</Text>
                </View>
              ) : null}
              {it.to ? <Icon name="chevron" size={18} color={colors.inkMuted} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const shadow = { shadowColor: '#0F1A17', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 };
const styles = StyleSheet.create({
  menuBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#C9D3D0', ...shadow },
  dot: { position: 'absolute', top: 9, right: 9, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,26,23,0.45)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.surface, paddingHorizontal: 12, borderTopRightRadius: radius.xl, borderBottomRightRadius: radius.xl, ...shadow, elevation: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 4 },
  brand: { fontFamily: fonts.display, fontSize: 24, color: colors.accent },
  tagline: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: 22, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  closeX: { fontSize: 26, lineHeight: 28, color: colors.ink, fontFamily: fonts.medium },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 8, paddingVertical: 8, borderRadius: radius.md },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkMuted },
  badge: { borderRadius: radius.pill, backgroundColor: colors.accentSoft, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentPressed },
});
