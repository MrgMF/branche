// Choix du véhicule et du % de batterie — facultatif, jamais bloquant, enregistré sur l'appareil seulement.
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice } from '../components/ui';
import { detectBrandApps } from '../lib/detectBrand';
import { getFeatures } from '../lib/features';
import { photoIdentify } from '../lib/identifyPhoto';
import { modelsOfBrand } from '../lib/vehicleApps';
import { searchVehicles } from '../lib/vehicleSearch';
import { PLUG_LABEL } from '../lib/format';
import { loadVehicle, saveVehicle, VEHICLE_SOURCE_NOTE, VEHICLES, type VehicleModel } from '../lib/vehicle';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

const PRESETS = [10, 20, 30, 50, 70];

export default function VehiculeScreen() {
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
      else if (!r.vehicleId) setPhotoMsg('Modèle non reconnu : cherchez-le dans la liste.');
      else {
        const m = VEHICLES.find((x) => x.id === r.vehicleId);
        if (m) {
          setSel(m);
          setQ('');
          setPhotoMsg(`Reconnu : ${m.name}. Vérifiez puis enregistrez.`);
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

  const done = () => (router.canGoBack() ? router.back() : router.replace('/'));
  async function save() {
    if (sel) await saveVehicle({ ...sel, socPercent: soc, socUpdatedAt: Date.now() });
    done();
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.head}>
        <Text style={styles.h1} accessibilityRole="header">Votre véhicule</Text>
        <Button label="Passer" variant="ghost" onPress={done} style={styles.skip} hint="Continuer sans véhicule : estimation pour un véhicule moyen" />
      </View>
      <Text style={styles.p}>Pour afficher les prises compatibles et estimer durée et prix. Facultatif, gardé sur ce téléphone.</Text>
      {brands.length && !sel ? (
        <View style={styles.brand}>
          <Text style={styles.brandText}>Nous avons vu l’appli {brands.map((b) => b.brand).join(', ')} sur ce téléphone : est-ce votre voiture ?</Text>
          <View style={styles.brandRow}>
            {brands.map((b) => (
              <Button key={b.prefix} label={b.brand} variant="secondary" onPress={() => setBrandOnly(b.prefix)} style={styles.brandBtn} />
            ))}
            {brandOnly ? <Button label="Toutes les marques" variant="ghost" onPress={() => setBrandOnly(null)} style={styles.brandBtn} /> : null}
          </View>
          <Text style={styles.small}>Vérifié uniquement sur ce téléphone, jamais envoyé.</Text>
        </View>
      ) : null}
      {canPhoto ? (
        <Button label="Prendre en photo" variant="secondary" onPress={photo} loading={photoBusy} hint="La photo est envoyée pour reconnaître le modèle puis oubliée, jamais conservée" />
      ) : null}
      {photoMsg ? <Notice>{photoMsg}</Notice> : null}
      <TextInput value={q} onChangeText={setQ} placeholder="Modèle : megane, model 3, zoe…" placeholderTextColor="#6B7773" aria-label="Rechercher un modèle" style={styles.input} autoCorrect={false} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {list.map((m) => (
          <Pressable
            key={m.id}
            role="radio"
            aria-checked={sel?.id === m.id}
            accessibilityState={{ checked: sel?.id === m.id }}
            accessibilityLabel={`${m.name}, batterie ${m.batteryKWh} kWh, charge rapide ${m.maxDcKW} kW`}
            onPress={() => setSel(m)}
            style={[styles.item, sel?.id === m.id && styles.itemOn]}
          >
            <Text style={styles.itemTitle}>{m.name}</Text>
            <Text style={styles.small}>
              {m.batteryKWh.toLocaleString('fr-FR')} kWh · rapide {m.maxDcKW} kW · normal {m.maxAcKW.toLocaleString('fr-FR')} kW · {m.plugs.map((p) => PLUG_LABEL[p]).join(', ')}
            </Text>
          </Pressable>
        ))}
        {!list.length ? <Text style={styles.p}>Modèle absent de la liste : passez, l’estimation utilisera un véhicule moyen.</Text> : null}
        <Text style={styles.small}>{VEHICLE_SOURCE_NOTE}</Text>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.label} nativeID="soc-label">
          Batterie actuelle : {soc} %
        </Text>
        <View style={styles.presets} accessibilityLabelledBy="soc-label">
          <Pressable accessibilityRole="button" accessibilityLabel="Moins 5 %" onPress={() => setSoc((x) => Math.max(0, x - 5))} style={styles.chip}>
            <Text style={styles.chipText}>−</Text>
          </Pressable>
          {PRESETS.map((p) => (
            <Pressable key={p} role="radio" aria-checked={soc === p} accessibilityState={{ checked: soc === p }} accessibilityLabel={`${p} %`} onPress={() => setSoc(p)} style={[styles.chip, soc === p && styles.chipOn]}>
              <Text style={[styles.chipText, soc === p && { color: '#FFFFFF' }]}>{p}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Plus 5 %" onPress={() => setSoc((x) => Math.min(100, x + 5))} style={styles.chip}>
            <Text style={styles.chipText}>+</Text>
          </Pressable>
        </View>
        <Button label={sel ? `Enregistrer ${sel.name}` : 'Choisissez un modèle'} onPress={save} disabled={!sel} />
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
  input: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: '#C9D3D0', paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
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
  chip: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.sm, borderWidth: 1, borderColor: '#C9D3D0', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
