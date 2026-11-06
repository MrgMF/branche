// Choix du véhicule et du % de batterie — facultatif, jamais bloquant, enregistré sur l'appareil seulement.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice } from '../components/ui';
import { detectBrandApps } from '../lib/detectBrand';
import { getFeatures } from '../lib/features';
import { photoIdentify } from '../lib/identifyPhoto';
import { modelsOfBrand } from '../lib/vehicleApps';
import { searchVehicles } from '../lib/vehicleSearch';
import { plugLabel } from '../lib/format';
import { loadVehicle, saveVehicle, VEHICLES, type VehicleModel } from '../lib/vehicle';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';
import { goBack, ScreenHeader } from '../components/Screen';
import { useT } from '../i18n';
import { num } from '../i18n/format';

const PRESETS = [10, 20, 30, 50, 70];

export default function VehiculeScreen() {
  const t = useT();
  const V = t.vehicle;
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<VehicleModel | null>(null);
  const [soc, setSoc] = useState(20);
  const [brands, setBrands] = useState<{ brand: string; prefix: string }[]>([]);
  const [brandOnly, setBrandOnly] = useState<string | null>(null);
  const [canPhoto, setCanPhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);

  useEffect(() => {
    detectBrandApps().then(setBrands);
    getFeatures().then((f) => setCanPhoto(f.vehicleIdentify));
  }, []);

  async function photo() {
    setPhotoMsg(null);
    setPhotoBusy(true);
    try {
      const r = await photoIdentify();
      if (!r) return;
      if ('error' in r) setPhotoMsg(r.error);
      else if (!r.vehicleId) setPhotoMsg(V.notRecognized);
      else {
        const m = VEHICLES.find((x) => x.id === r.vehicleId);
        if (m) {
          setSel(m);
          setQ('');
          setPhotoMsg(V.recognized(m.name));
        }
      }
    } finally {
      setPhotoBusy(false);
    }
  }

  useEffect(() => {
    loadVehicle().then((v) => {
      if (!v) return;
      setSel(VEHICLES.find((m) => m.id === v.id) ?? v);
      setSoc(v.socPercent);
    });
  }, []);

  const list = useMemo(() => {
    const found = searchVehicles(q, brandOnly ? modelsOfBrand(brandOnly) : VEHICLES);
    // Le modèle choisi (photo, profil enregistré) reste visible en tête
    return sel && !q && !found.some((m) => m.id === sel.id) ? [sel, ...found] : found;
  }, [q, brandOnly, sel]);

  const done = goBack;
  async function save() {
    if (sel) await saveVehicle({ ...sel, socPercent: soc, socUpdatedAt: Date.now() });
    done();
  }

  // 7 cibles ≥ 44 px + espaces : une ligne seulement si la largeur le permet (≥ 376 px), sinon deux lignes
  const twoRows = useWindowDimensions().width < 376;
  const minus = (
    <Pressable key="minus" accessibilityRole="button" accessibilityLabel={V.minus} onPress={() => setSoc((x) => Math.max(0, x - 5))} style={styles.chip}>
      <Text style={styles.chipText}>−</Text>
    </Pressable>
  );
  const plus = (
    <Pressable key="plus" accessibilityRole="button" accessibilityLabel={V.plus} onPress={() => setSoc((x) => Math.min(100, x + 5))} style={styles.chip}>
      <Text style={styles.chipText}>+</Text>
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <ScreenHeader title={t.titles.vehicule} right={<Button label={t.common.skip} variant="ghost" onPress={done} style={styles.skip} hint={V.skipHint} />} />
      <Text style={styles.p}>{V.why}</Text>
      {brands.length && !sel ? (
        <View style={styles.brand}>
          <Text style={styles.brandText}>{V.brandSeen(brands.map((b) => b.brand).join(', '))}</Text>
          <View style={styles.brandRow}>
            {brands.map((b) => (
              <Button key={b.prefix} label={b.brand} variant="secondary" onPress={() => setBrandOnly(b.prefix)} style={styles.brandBtn} />
            ))}
            {brandOnly ? <Button label={V.allBrands} variant="ghost" onPress={() => setBrandOnly(null)} style={styles.brandBtn} /> : null}
          </View>
          <Text style={styles.small}>{V.localOnly}</Text>
        </View>
      ) : null}
      {canPhoto ? (
        <Button label={V.photo} variant="secondary" onPress={photo} loading={photoBusy} hint={V.photoHint} />
      ) : null}
      {photoMsg ? <Notice>{photoMsg}</Notice> : null}
      <TextInput value={q} onChangeText={setQ} placeholder={V.searchPh} placeholderTextColor="#6B7773" aria-label={V.searchA11y} style={styles.input} autoCorrect={false} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {list.map((m) => (
          <Pressable
            key={m.id}
            role="radio"
            aria-checked={sel?.id === m.id}
            accessibilityState={{ checked: sel?.id === m.id }}
            accessibilityLabel={V.itemA11y(m.name, m.batteryKWh, m.maxDcKW)}
            onPress={() => setSel(m)}
            style={[styles.item, sel?.id === m.id && styles.itemOn]}
          >
            <Text style={styles.itemTitle}>{m.name}</Text>
            <Text style={styles.small}>
              {V.itemMeta(num(m.batteryKWh), m.maxDcKW, num(m.maxAcKW), m.plugs.map((p) => plugLabel(p)).join(', '))}
            </Text>
          </Pressable>
        ))}
        {!list.length ? <Text style={styles.p}>{V.absent}</Text> : null}
        <Text style={styles.small}>{V.sourceNote}</Text>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.label} nativeID="soc-label">
          {V.socLabel(soc)}
        </Text>
        {/* 7 cibles de 44 px ne tiennent pas sur une ligne étroite : préréglages, puis − et + sur une 2e ligne */}
        <View style={[styles.presets, twoRows && styles.presetsWrap]} accessibilityLabelledBy="soc-label">
          {twoRows ? null : minus}
          {PRESETS.map((p) => (
            <Pressable key={p} role="radio" aria-checked={soc === p} accessibilityState={{ checked: soc === p }} accessibilityLabel={`${p} %`} onPress={() => setSoc(p)} style={[styles.chip, twoRows && styles.presetWide, soc === p && styles.chipOn]}>
              <Text style={[styles.chipText, soc === p && { color: colors.onAccent }]}>{p}</Text>
            </Pressable>
          ))}
          {twoRows ? null : plus}
        </View>
        {twoRows ? (
          <View style={styles.presets}>
            {minus}
            {plus}
          </View>
        ) : null}
        <Button label={sel ? V.save(sel.name) : V.pickModel} onPress={save} disabled={!sel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 16, gap: 10, maxWidth: 600, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  h1: { flex: 1, fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  skip: { minHeight: MIN_TOUCH, paddingHorizontal: 16 },
  p: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkMuted },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.inputBorder, paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
  brand: { backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 12, gap: 8 },
  brandText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink },
  brandRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  brandBtn: { minHeight: MIN_TOUCH, paddingHorizontal: 12, flexGrow: 1 },
  item: { minHeight: 60, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 2, justifyContent: 'center' },
  itemOn: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft },
  itemTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  footer: { gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  presets: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  chip: { flex: 1, minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.inputBorder, alignItems: 'center', justifyContent: 'center' },
  // Deux lignes (écran étroit) : 5 préréglages, puis − et + côte à côte
  presetsWrap: {},
  presetWide: { flexBasis: 0, flexGrow: 1 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
