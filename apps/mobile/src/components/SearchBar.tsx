// Recherche d'adresse ou de lieu (TomTom Search, repli Photon), avec destinations récentes stockées sur l'appareil.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { distanceKm } from '../lib/stations';
import { km } from '../lib/format';
import { searchPlaces, type Place } from '../lib/navigation';
import { addRecent, clearRecents, loadRecents } from '../lib/recents';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { NavIcon } from './ManeuverIcon';
import { useT } from '../i18n';

export function SearchBar(props: { near: { lat: number; lon: number } | null; onSelect: (p: Place) => void; onFocusChange?: (f: boolean) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [recents, setRecents] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState('');
  const input = useRef<{ blur: () => void } | null>(null);
  const nearRef = useRef(props.near);
  nearRef.current = props.near;

  useEffect(() => {
    loadRecents().then(setRecents);
  }, []);

  useEffect(() => {
    const text = q.trim();
    setError(null);
    if (text.length < 3) {
      setResults([]);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      searchPlaces(text, nearRef.current, ctrl.signal)
        .then((r) => {
          setResults(r.results);
          setAttribution(r.attribution);
          if (!r.results.length) setError(t.search.none);
        })
        .catch((e) => {
          if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : t.search.unavailable);
        })
        .finally(() => setBusy(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const focus = (f: boolean) => {
    setFocused(f);
    props.onFocusChange?.(f);
  };

  async function pick(p: Place) {
    setRecents(await addRecent(p));
    setQ('');
    setResults([]);
    input.current?.blur();
    focus(false);
    props.onSelect(p);
  }

  const showRecents = focused && q.trim().length < 3 && recents.length > 0;
  const list = showRecents ? recents : results;
  const open = focused && (list.length > 0 || !!error || busy);

  return (
    <View style={styles.wrap} accessibilityRole="search">
      <View style={[styles.box, focused && styles.boxFocused]}>
        <NavIcon name="search" size={22} color={colors.inkMuted} />
        <TextInput
          ref={input as never}
          value={q}
          onChangeText={setQ}
          onFocus={() => focus(true)}
          onBlur={() => setTimeout(() => focus(false), Platform.OS === 'web' ? 200 : 0)}
          placeholder={t.search.placeholder}
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel={t.search.a11y}
          returnKeyType="search"
          autoCorrect={false}
          style={styles.input}
          onSubmitEditing={() => results[0] && pick(results[0])}
        />
        {busy ? <ActivityIndicator color={colors.accent} /> : null}
        {q ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t.search.clear} onPress={() => setQ('')} style={styles.clear}>
            <NavIcon name="close" size={18} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={styles.panel} accessibilityRole="list">
          {showRecents ? (
            <View style={styles.headRow}>
              <Text style={styles.head}>{t.search.recents}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.search.clearRecentsA11y}
                onPress={async () => {
                  await clearRecents();
                  setRecents([]);
                }}
                style={styles.headBtn}
              >
                <Text style={styles.headLink}>{t.search.clearRecents}</Text>
              </Pressable>
            </View>
          ) : null}
          {list.map((p) => (
            <Pressable
              key={`${p.label}|${p.sublabel}|${p.lat}`}
              accessibilityRole="button"
              accessibilityLabel={`${p.label}, ${p.sublabel}`}
              onPress={() => pick(p)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceAlt }]}
            >
              <NavIcon name={showRecents ? 'history' : 'search'} size={18} color={colors.inkMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.label} numberOfLines={1}>
                  {p.label}
                </Text>
                {p.sublabel ? (
                  <Text style={styles.sub} numberOfLines={1}>
                    {p.sublabel}
                  </Text>
                ) : null}
              </View>
              {props.near ? <Text style={styles.sub}>{km(distanceKm(props.near, p))}</Text> : null}
            </Pressable>
          ))}
          {error && !showRecents ? <Text style={styles.error}>{error}</Text> : null}
          {!showRecents && results.length ? <Text style={styles.attr}>{t.search.attribution(attribution)}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#C9D3D0',
    shadowColor: '#0F1A17',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  boxFocused: { borderColor: colors.accent, borderWidth: 2 },
  input: { flex: 1, minWidth: 0, minHeight: 48, fontFamily: fonts.medium, fontSize: 16, color: colors.ink, outlineStyle: 'none' } as object,
  clear: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 6,
    shadowColor: '#0F1A17',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14 },
  head: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  headBtn: { minHeight: MIN_TOUCH, paddingHorizontal: 14, justifyContent: 'center' },
  headLink: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accentPressed },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8 },
  label: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkMuted },
  error: { fontFamily: fonts.medium, fontSize: 14, color: colors.danger, paddingHorizontal: 14, paddingVertical: 10 },
  attr: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 6 },
});
