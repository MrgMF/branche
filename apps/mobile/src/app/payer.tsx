import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Notice } from '../components/ui';
import { DEV_HOSTS } from '../lib/config';
import { directPayUrl, openOperatorPayment, operatorLabel, operatorOf } from '../lib/connectors';
import { PAY_LABEL } from '../lib/format';
import { verifyQr, type Operator, type QrResult } from '../lib/qr';
import { displayName, findByEvse, loadOperators, type Station } from '../lib/stations';
import { store } from '../lib/store';
import { colors, fonts, MIN_TOUCH, radius } from '../theme';

const TONE: Record<QrResult['verdict'], { bg: string; fg: string; title: string }> = {
  official: { bg: colors.accentSoft, fg: colors.accentPressed, title: 'Page de paiement officielle' },
  'known-operator': { bg: colors.accentSoft, fg: colors.accentPressed, title: 'Opérateur reconnu' },
  unknown: { bg: colors.warnSoft, fg: '#7A3E06', title: 'Lien non vérifié' },
  dangerous: { bg: '#FDECEC', fg: colors.danger, title: 'QR code suspect — paiement bloqué' },
};

export default function Payer() {
  const insets = useSafeAreaInsets();
  const [station, setStation] = useState<Station | null>(store.current());
  const [ops, setOps] = useState<Operator[]>([]);
  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<QrResult | null>(null);
  const [confirmUnknown, setConfirmUnknown] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    loadOperators().then(setOps);
  }, []);

  const opName = operatorLabel(station, ops);
  const knownUrl = station ? directPayUrl(station, ops) : null;

  function check(raw: string) {
    const r = verifyQr(raw, station?.ok ?? null, ops, { devHosts: DEV_HOSTS });
    if (r.kind === 'evse' && r.evse) {
      const found = findByEvse(store.stations(), r.evse);
      if (found) {
        setStation(found);
        store.setCurrent(found);
      }
    }
    setConfirmUnknown(false);
    setResult(r);
    setScanning(false);
  }

  function onScan(e: BarcodeScanningResult) {
    if (locked.current) return;
    locked.current = true;
    check(e.data);
    setTimeout(() => (locked.current = false), 1500);
  }

  async function startScan() {
    setResult(null);
    if (!perm?.granted) {
      const p = await requestPerm();
      if (!p.granted) return;
    }
    setScanning(true);
  }

  const payName = result?.operatorKey ? (ops.find((o) => o.key === result.operatorKey)?.names[0] ?? opName) : opName;
  const tone = result ? TONE[result.verdict] : null;
  const atStation = station?.pay.filter((p) => p === 'cb' || p === 'sans_contact').map((p) => PAY_LABEL[p]) ?? [];

  return (
    <ScrollView style={{ backgroundColor: colors.surface }} contentContainerStyle={[styles.body, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.head}>
        <Button label="Retour" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.back} />
        <View style={{ flex: 1 }}>
          <Text style={styles.h1} accessibilityRole="header">Payer la borne</Text>
          {station ? <Text style={styles.sub} numberOfLines={2}>{displayName(station)} · {opName}</Text> : null}
        </View>
      </View>

      <Text style={styles.p}>
        Vous payez directement {opName} sur sa page officielle, ouverte dans Branché : sans compte, sans télécharger son application. Branché ne voit pas votre carte.
      </Text>

      {knownUrl ? (
        <Button label={`Ouvrir le paiement ${opName}`} onPress={() => openOperatorPayment(knownUrl, station, opName)} hint="Page de paiement officielle de l’opérateur" />
      ) : null}

      {scanning ? (
        <View style={styles.camWrap}>
          <CameraView style={styles.cam} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
          <View pointerEvents="none" style={styles.frame} />
          <Button label="Arrêter le scan" variant="light" onPress={() => setScanning(false)} style={styles.stop} />
        </View>
      ) : (
        <Button
          label="Scanner le QR code de la borne"
          variant={knownUrl ? 'secondary' : 'primary'}
          onPress={startScan}
          hint="Ouvre l’appareil photo pour lire le QR code collé sur la borne"
        />
      )}
      {perm && !perm.granted && !perm.canAskAgain ? (
        <Notice tone="error">Appareil photo refusé : autorisez-le dans les réglages, ou saisissez le code ci-dessous.</Notice>
      ) : null}

      <View style={styles.manual}>
        <Text style={styles.label} nativeID="manual-label">
          Ou saisissez le lien ou l’identifiant inscrit sur la borne
        </Text>
        <View style={styles.row}>
          <TextInput
            value={manual}
            onChangeText={setManual}
            placeholder="ex. FR*ABC*E1234 ou https://…"
            placeholderTextColor="#7A8682"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabelledBy="manual-label"
            aria-label="Lien ou identifiant de la borne"
            style={styles.input}
            onSubmitEditing={() => manual.trim() && check(manual)}
            returnKeyType="go"
          />
          <Button label="Vérifier" variant="ghost" onPress={() => check(manual)} disabled={!manual.trim()} style={styles.verify} />
        </View>
      </View>

      {result && tone ? (
        <View style={[styles.result, { backgroundColor: tone.bg }]} accessibilityLiveRegion="polite">
          <Text style={[styles.resultTitle, { color: tone.fg }]}>{result.kind === 'evse' ? 'Borne identifiée' : tone.title}</Text>
          {result.domain ? <Text style={[styles.domain, { color: tone.fg }]}>{result.domain}</Text> : null}
          {result.reasons.map((r) => (
            <Text key={r} style={[styles.reason, { color: tone.fg }]}>
              {r}
            </Text>
          ))}

          {result.kind === 'url' && (result.verdict === 'official' || result.verdict === 'known-operator') && result.url ? (
            <Text style={[styles.reason, { color: tone.fg }]}>Vérifiez que le QR code est imprimé sur la borne, pas collé par-dessus. Branché ne voit pas votre carte et n’encaisse rien.</Text>
          ) : null}
          {result.kind === 'url' && (result.verdict === 'official' || result.verdict === 'known-operator') && result.url ? (
            <Button label={`Payer sur la page ${payName}`} onPress={() => openOperatorPayment(result.url!, station, payName)} />
          ) : null}

          {result.kind === 'url' && result.verdict === 'unknown' && result.url ? (
            <>
              <Text style={[styles.reason, { color: tone.fg }]}>
                Avant de payer, vérifiez que le QR code n’est pas un autocollant ajouté par-dessus l’original et que la page affiche bien le nom de l’opérateur.
              </Text>
              <Pressable
                role="checkbox"
                aria-checked={confirmUnknown}
                accessibilityState={{ checked: confirmUnknown }}
                onPress={() => setConfirmUnknown((v) => !v)}
                style={styles.check}
              >
                <View style={[styles.box, confirmUnknown && styles.boxOn]} />
                <Text style={styles.checkText}>J’ai vérifié la borne et je veux continuer</Text>
              </Pressable>
              <Button label="Continuer vers ce site" variant="secondary" disabled={!confirmUnknown} onPress={() => openOperatorPayment(result.url!, station, result.domain ?? 'site inconnu')} />
            </>
          ) : null}

          {result.verdict === 'dangerous' ? (
            <Text style={[styles.reason, { color: tone.fg }]}>
              Ne saisissez pas votre carte sur ce lien. {atStation.length ? `Payez plutôt sur le lecteur de la borne (${atStation.join(', ')}).` : 'Payez plutôt sur le lecteur de la borne ou prévenez l’opérateur.'}
            </Text>
          ) : null}

          {result.kind === 'evse' ? (
            <Text style={[styles.reason, { color: tone.fg }]}>
              {station ? `Il s’agit de ${displayName(station)}. ` : ''}
              Cet identifiant ne contient pas de lien de paiement : scannez le QR code de paiement de la borne ou payez sur son lecteur de carte.
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Autres moyens</Text>
        <Text style={styles.p}>{atStation.length ? `Lecteur de la borne : ${atStation.join(' et ').toLowerCase()} accepté${atStation.length > 1 ? 's' : 'e'}.` : 'Lecteur de carte : obligatoire sur toutes les bornes rapides (≥ 50 kW) à partir de 2027.'}</Text>
        <Text style={styles.p}>Carte Branché dans votre Wallet : bientôt. Une seule carte, acceptée sur tous les lecteurs CB.</Text>
        {station?.tel ? (
          <Pressable accessibilityRole="link" style={styles.link} onPress={() => Linking.openURL(`tel:${station.tel!.replace(/[^+\d]/g, '')}`)}>
            <Text style={styles.linkText}>Problème ? Appeler {opName}</Text>
          </Pressable>
        ) : null}
      </View>
      {Platform.OS === 'web' ? <Text style={styles.small}>Sur ordinateur, la page de l’opérateur s’ouvre dans un nouvel onglet.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 14, maxWidth: 600, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: MIN_TOUCH, paddingHorizontal: 14 },
  h1: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
  p: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkMuted },
  camWrap: { height: 340, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  cam: { flex: 1 },
  frame: { position: 'absolute', top: 60, left: '18%', right: '18%', bottom: 90, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 18 },
  stop: { position: 'absolute', left: 16, right: 16, bottom: 16, minHeight: 48 },
  manual: { gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#C9D3D0',
    paddingHorizontal: 14,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  verify: { minHeight: 52, paddingHorizontal: 16, flexShrink: 0 },
  result: { borderRadius: radius.lg, padding: 16, gap: 8 },
  resultTitle: { fontFamily: fonts.bold, fontSize: 17 },
  domain: { fontFamily: fonts.semibold, fontSize: 15 },
  reason: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TOUCH },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#7A3E06', backgroundColor: '#FFFFFF' },
  boxOn: { backgroundColor: '#7A3E06' },
  checkText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  card: { backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: 16, gap: 6 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.accent },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
});
