import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Onboarding } from '../components/Onboarding';
import { Button } from '../components/ui';
import { useLocale, useT } from '../i18n';
import { startCheckinSync } from '../lib/checkinSync';
import { loadSettings } from '../lib/settings';
import { useOnboarding } from '../lib/useOnboarding';
import { loadVoicePref } from '../lib/voice';
import { colors, fonts } from '../theme';

/**
 * Écran d'erreur d'Expo Router (écran qui plante, module introuvable hors ligne) : message clair et « Réessayer »,
 * jamais une page blanche. La recharge en cours est persistée à part (store.ts) et n'est pas perdue.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const t = useT();
  return (
    <View style={styles.err} accessibilityRole="alert">
      <Text style={styles.errTitle} accessibilityRole="header">
        {t.common.errorTitle}
      </Text>
      <Text style={styles.errBody}>{t.common.errorBody}</Text>
      <Button label={t.common.retry} onPress={() => void retry()} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Écrans du paiement chargés d'avance après le premier affichage : disponibles même si le réseau tombe ensuite. */
function preloadPayScreens() {
  void import('./recharger').catch(() => undefined);
  void import('./payer').catch(() => undefined);
  void import('./recharge').catch(() => undefined);
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const [ready, setReady] = useState(false);
  const [onboarding, endOnboarding] = useOnboarding();
  const t = useT();
  const { tag } = useLocale();

  useEffect(() => {
    Promise.all([loadSettings(), loadVoicePref()]).finally(() => setReady(true));
  }, []);
  // Après le premier affichage (sans retarder l'ouverture) : recharger / payer / recharge préchargés
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(preloadPayScreens, 1200);
    return () => clearTimeout(id);
  }, [ready]);
  // Retours « Ça a marché ? » saisis hors ligne : renvoyés au retour du réseau
  useEffect(() => startCheckinSync(), []);
  // Langue du document (lecteurs d'écran, césure, traduction du navigateur)
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = tag;
  }, [tag]);

  if ((!loaded && !error) || onboarding === null || !ready) return null;
  const T = t.titles;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {onboarding === true ? (
        <Onboarding onDone={endOnboarding} />
      ) : (
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' }, gestureEnabled: true }}>
            <Stack.Screen name="index" options={{ title: T.index }} />
            <Stack.Screen name="session" options={{ title: T.session }} />
            <Stack.Screen name="about" options={{ title: T.about }} />
            <Stack.Screen name="payer" options={{ title: T.payer }} />
            <Stack.Screen name="recharge" options={{ title: T.recharge }} />
            <Stack.Screen name="recharger" options={{ title: T.recharger }} />
            <Stack.Screen name="historique" options={{ title: T.historique }} />
            <Stack.Screen name="vehicule" options={{ title: T.vehicule }} />
            <Stack.Screen name="comptes" options={{ title: T.comptes }} />
            <Stack.Screen name="reglages" options={{ title: T.reglages }} />
            <Stack.Screen name="ma-recharge" options={{ title: T.maRecharge }} />
          </Stack>
          {onboarding === 'replay' ? (
            <View style={StyleSheet.absoluteFill}>
              <Onboarding onDone={endOnboarding} />
            </View>
          ) : null}
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  err: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: colors.surface },
  errTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink, textAlign: 'center' },
  errBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.inkMuted, textAlign: 'center', maxWidth: 480 },
});
