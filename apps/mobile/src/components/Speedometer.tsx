// Compteur de vitesse à la Waze : vitesse GPS (km/h ou mph) et panneau de limitation quand elle est connue.
// Au-delà de limite + 3 km/h pendant 2 s : compteur rouge et léger liseré rouge sur les bords de l'écran (non bloquant),
// annonce au lecteur d'écran une fois par dépassement. Réglages : « Afficher la vitesse », « Alerte de dépassement ».
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useT } from '../i18n';
import { speedUnit, speedValue } from '../i18n/format';
import { useSettings } from '../lib/settings';
import { SPEEDO_IDLE, stepSpeedo, type SpeedoView } from '../lib/speedo';
import { colors, fonts } from '../theme';

const TICK_MS = 500;

export interface SpeedoReading {
  /** Vitesse mesurée (km/h). */
  kmh: number | null;
  /** Horodatage de la position correspondante (change à chaque nouvelle position). */
  sampleT: number | null;
  limitKmh: number | null;
  guiding: boolean;
}

export interface Speedo extends SpeedoView {
  limitKmh: number | null;
  /** Réglage « Afficher la vitesse ». */
  enabled: boolean;
  /** Dépassement signalé (réglage « Alerte de dépassement » actif). */
  alert: boolean;
}

/** État du compteur : réévalué à chaque position et toutes les 500 ms (lissage, mesure périmée, maintien après l'arrêt). */
export function useSpeedo({ kmh, sampleT, limitKmh, guiding }: SpeedoReading): Speedo {
  const set = useSettings();
  const state = useRef(SPEEDO_IDLE);
  const receivedAt = useRef<number | null>(null);
  const input = useRef({ kmh, limitKmh, guiding });
  input.current = { kmh, limitKmh, guiding };
  const [view, setView] = useState<SpeedoView>({ show: guiding, kmh: null, over: false });

  const evaluate = useCallback(() => {
    const r = stepSpeedo(state.current, { ...input.current, receivedAt: receivedAt.current }, Date.now());
    state.current = r.state;
    setView((v) => (v.show === r.view.show && v.kmh === r.view.kmh && v.over === r.view.over ? v : r.view));
  }, []);

  useEffect(() => {
    if (sampleT !== null) receivedAt.current = Date.now();
  }, [sampleT]);
  useEffect(evaluate, [kmh, sampleT, limitKmh, guiding, evaluate]);
  useEffect(() => {
    if (!set.showSpeed) return;
    const i = setInterval(evaluate, TICK_MS);
    return () => clearInterval(i);
  }, [set.showSpeed, evaluate]);

  const enabled = set.showSpeed;
  return { ...view, show: enabled && view.show, limitKmh, enabled, alert: enabled && set.speedAlert && view.over };
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduce(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}

/** Compteur (et panneau de limitation). Rien si le réglage est coupé ou, hors guidage, tant qu'on ne roule pas. */
export function Speedometer({ s, style }: { s: Speedo; style?: StyleProp<ViewStyle> }) {
  const t = useT();
  const limitTxt = s.limitKmh ? `${speedValue(s.limitKmh)} ${speedUnit()}` : null;
  const msg = s.alert && limitTxt ? t.guidance.overAnnounce(limitTxt) : '';
  // Natif : une annonce par dépassement (au passage au rouge). Web : région live ci-dessous.
  useEffect(() => {
    if (msg && Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(msg);
  }, [msg]);
  if (!s.show) return null;
  const red = s.alert;
  return (
    <View style={[styles.box, style]} pointerEvents="none" testID="speedometer">
      <View
        style={styles.row}
        accessible
        accessibilityRole="text"
        accessibilityLabel={t.guidance.speedA11y(s.kmh === null ? null : `${speedValue(s.kmh)} ${speedUnit()}`, limitTxt, red)}
      >
        {s.limitKmh ? (
          <View style={styles.limit} testID="speed-limit">
            <Text style={styles.limitText} maxFontSizeMultiplier={1.3}>
              {speedValue(s.limitKmh)}
            </Text>
          </View>
        ) : null}
        <View style={[styles.speed, red && styles.speedOver]} testID="speed" {...({ dataSet: { over: red ? 'true' : 'false' } } as object)}>
          <Text style={[styles.speedText, red && styles.onRed]} maxFontSizeMultiplier={1.3}>
            {s.kmh === null ? '–' : speedValue(s.kmh)}
          </Text>
          <Text style={[styles.speedUnit, red && styles.onRed]} maxFontSizeMultiplier={1.3}>
            {speedUnit()}
          </Text>
        </View>
      </View>
      {Platform.OS === 'web' ? (
        <Text style={styles.hidden} accessibilityLiveRegion="assertive" testID="overspeed-live">
          {msg}
        </Text>
      ) : null}
    </View>
  );
}

/** Liseré rouge discret sur les bords de l'écran pendant un dépassement (à placer en dernier, plein écran). */
export function SpeedEdge({ on }: { on: boolean }) {
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(on ? 1 : 0)).current;
  const [mounted, setMounted] = useState(on);
  useEffect(() => {
    if (on) setMounted(true);
    if (reduce) {
      opacity.setValue(on ? 1 : 0);
      if (!on) setMounted(false);
      return;
    }
    const a = Animated.timing(opacity, { toValue: on ? 1 : 0, duration: 300, useNativeDriver: Platform.OS !== 'web' });
    a.start(({ finished }) => finished && !on && setMounted(false));
    return () => a.stop();
  }, [on, reduce, opacity]);
  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.edge, { opacity }]}
      testID="overspeed-edge"
    />
  );
}

const shadow = { shadowColor: '#0F1A17', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 };

const styles = StyleSheet.create({
  box: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  speed: { minWidth: 76, minHeight: 76, paddingHorizontal: 6, borderRadius: 999, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow },
  speedOver: { backgroundColor: colors.danger },
  speedText: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: colors.ink },
  speedUnit: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted },
  onRed: { color: colors.onAccent },
  limit: { minWidth: 60, minHeight: 60, paddingHorizontal: 4, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 7, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', ...shadow },
  limitText: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 5, borderColor: colors.dangerEdge, boxShadow: `inset 0 0 40px 8px ${colors.dangerEdge}` },
});
