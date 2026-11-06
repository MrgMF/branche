import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Onboarding } from '../components/Onboarding';
import { useLocale, useT } from '../i18n';
import { startCheckinSync } from '../lib/checkinSync';
import { loadSettings } from '../lib/settings';
import { useOnboarding } from '../lib/useOnboarding';
import { loadVoicePref } from '../lib/voice';

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
