// Réglages : langue, position (état et accès aux réglages), voix de guidage, itinéraire par défaut, unités, présentation, données locales (persistés sur l'appareil).
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/Screen';
import { Button, Notice } from '../components/ui';
import { LANG_NAMES, LANGS, useT, type Lang } from '../i18n';
import { deviceLang } from '../i18n/device';
import { resetLocalData, updateSettings, useSettings } from '../lib/settings';
import { showOnboardingAgain } from '../lib/useOnboarding';
import { isMuted, onMutedChange, setMuted } from '../lib/voice';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { useLargeText } from '../lib/useLargeText';

export default function Reglages() {
  const t = useT();
  const S = t.settings;
  const insets = useSafeAreaInsets();
  const set = useSettings();
  const [voice, setVoice] = useState(!isMuted());
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const [resetErr, setResetErr] = useState(false);
  useEffect(() => onMutedChange((m) => setVoice(!m)), []);
  const dev = deviceLang().lang;
  // Texte agrandi : marges réduites pour que les mots ne soient pas coupés.
  const large = useLargeText();

  const langs: ('auto' | Lang)[] = ['auto', ...LANGS];
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.body, large && { paddingHorizontal: 6 }, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}>
      <ScreenHeader title={t.titles.reglages} />

      <Section title={S.language}>
        <View accessibilityRole="radiogroup" accessibilityLabel={S.language}>
          {langs.map((l, i) => {
            const on = set.lang === l;
            return (
              <Pressable
                key={l}
                role="radio"
                aria-checked={on}
                accessibilityState={{ checked: on }}
                testID={`lang-${l}`}
                onPress={() => updateSettings({ lang: l })}
                style={({ pressed }) => [styles.row, large && { paddingHorizontal: 10, gap: 8 }, i > 0 && styles.sep, pressed && styles.pressed]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.label} {...({ lang: l === 'auto' ? undefined : l } as object)}>
                    {l === 'auto' ? S.auto(LANG_NAMES[dev]) : LANG_NAMES[l]}
                  </Text>
                  {l === 'auto' ? <Text style={styles.sub}>{S.autoHint}</Text> : null}
                </View>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="check" size={16} color={colors.onAccent} /> : null}</View>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <PositionSection />

      <Section title={S.guidance}>
        <Toggle label={S.voice} sub={S.voiceHint} on={voice} onPress={() => setMuted(voice)} testID="set-voice" />
        <Text style={[styles.sub, styles.rowNote]}>{S.routeDefaults}</Text>
        <Toggle label={S.avoidTolls} on={set.avoidTolls} onPress={() => updateSettings({ avoidTolls: !set.avoidTolls })} testID="set-tolls" />
        <Toggle label={S.avoidMotorways} on={set.avoidMotorways} onPress={() => updateSettings({ avoidMotorways: !set.avoidMotorways })} sep testID="set-motorways" />
      </Section>

      <Section title={S.units}>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={S.units}>
          {(['km', 'mi'] as const).map((u) => {
            const on = set.units === u;
            return (
              <Pressable
                key={u}
                role="radio"
                aria-checked={on}
                accessibilityState={{ checked: on }}
                testID={`units-${u}`}
                onPress={() => updateSettings({ units: u })}
                style={[styles.segBtn, on && styles.segOn]}
              >
                <Text style={[styles.segText, on && { color: colors.onAccent }]}>{u === 'km' ? S.km : S.mi}</Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Button label={S.welcome} variant="secondary" onPress={showOnboardingAgain} />

      <Section title={S.data}>
        <View style={{ padding: 14, gap: 10 }}>
          <Text style={styles.sub}>{S.dataBody}</Text>
          {done ? <Notice>{S.resetDone}</Notice> : null}
          {resetErr ? <Notice tone="error">{S.resetError}</Notice> : null}
          {confirm ? (
            <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
              <Notice tone="error">{S.resetQ}</Notice>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  label={S.resetConfirm}
                  variant="secondary"
                  style={{ flex: 1, minHeight: 48, borderColor: colors.danger }}
                  onPress={async () => {
                    setResetErr(false);
                    try {
                      await resetLocalData();
                      setDone(true);
                    } catch {
                      // Historique non effacé (stockage indisponible) : le reste l'est ; on le dit.
                      setResetErr(true);
                    }
                    setConfirm(false);
                  }}
                />
                <Button label={t.common.cancel} variant="ghost" style={{ flex: 1, minHeight: 48 }} onPress={() => setConfirm(false)} />
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" testID="reset" onPress={() => { setDone(false); setResetErr(false); setConfirm(true); }} style={styles.danger}>
              <Text style={styles.dangerText}>{S.reset}</Text>
            </Pressable>
          )}
        </View>
      </Section>
    </ScrollView>
  );
}

type PosState = 'granted' | 'denied' | 'ask';

/** État de l'autorisation de position, avec la marche à suivre selon la plateforme. */
function PositionSection() {
  const t = useT();
  const S = t.settings;
  const [st, setSt] = useState<PosState | null>(null);
  const [canAsk, setCanAsk] = useState(true);
  const check = useCallback(async () => {
    try {
      const p = await Location.getForegroundPermissionsAsync();
      setSt(p.granted ? 'granted' : p.status === 'denied' ? 'denied' : 'ask');
      setCanAsk(p.canAskAgain);
    } catch {
      setSt('ask');
    }
  }, []);
  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (a) => a === 'active' && void check());
    return () => sub.remove();
  }, [check]);

  async function ask() {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      /* refus ou indisponible */
    }
    void check();
  }

  if (!st) return null;
  const web = Platform.OS === 'web';
  const tone = st === 'granted' ? colors.accent : st === 'denied' ? colors.danger : colors.inkMuted;
  return (
    <Section title={S.posTitle}>
      <View style={{ padding: 14, gap: 12 }} testID={`pos-${st}`}>
        <View style={styles.posRow} accessibilityLiveRegion="polite">
          <View style={[styles.posIcon, { borderColor: tone, backgroundColor: st === 'granted' ? tone : colors.surface }]}>
            <Svg width={16} height={16} viewBox="0 0 24 24">
              <Path
                d={st === 'granted' ? 'M5 12.5l4.5 4.5L19 7.5' : st === 'denied' ? 'M6 6l12 12M18 6L6 18' : 'M12 7v6M12 17v.5'}
                stroke={st === 'granted' ? colors.onAccent : tone}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
              />
            </Svg>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.label, { color: st === 'denied' ? colors.danger : colors.ink }]}>{st === 'granted' ? S.posGranted : st === 'denied' ? S.posDenied : S.posAsk}</Text>
            <Text style={styles.sub}>{st === 'granted' ? S.posGrantedBody : st === 'denied' ? S.posDeniedBody : S.posAskBody}</Text>
          </View>
        </View>
        {st === 'ask' || (st === 'denied' && !web && canAsk) ? <Button label={S.posAllow} onPress={ask} style={{ minHeight: 48 }} /> : null}
        {st === 'denied' && !web ? <Button label={S.posOpenSettings} variant="secondary" onPress={() => void Linking.openSettings()} style={{ minHeight: 48 }} /> : null}
        {st === 'denied' && web ? (
          <>
            <Text style={styles.help}>{S.posWebHelp}</Text>
            <Button label={S.posReload} variant="secondary" onPress={() => window.location.reload()} style={{ minHeight: 48 }} />
          </>
        ) : null}
      </View>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.h2} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Toggle({ label, sub, on, onPress, sep, testID }: { label: string; sub?: string; on: boolean; onPress: () => void; sep?: boolean; testID?: string }) {
  return (
    <Pressable role="switch" aria-checked={on} accessibilityState={{ checked: on }} accessibilityLabel={label} testID={testID} onPress={onPress} style={({ pressed }) => [styles.row, sep && styles.sep, pressed && styles.pressed]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: 16, gap: 18, maxWidth: 600, width: '100%', alignSelf: 'center' },
  h2: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  rowNote: { paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  sep: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceAlt },
  label: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
  posRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  posIcon: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  help: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12 },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.switchOff, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  track: { width: 52, height: 32, borderRadius: 16, backgroundColor: colors.switchOff, padding: 3, justifyContent: 'center' },
  trackOn: { backgroundColor: colors.accent },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surface },
  knobOn: { alignSelf: 'flex-end' },
  segment: { flexDirection: 'row', padding: 4, gap: 4 },
  segBtn: { flex: 1, minHeight: MIN_TOUCH + 4, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  segText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  danger: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  dangerText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
});
