import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Onboarding } from '../components/Onboarding';
import { useOnboarding } from '../lib/useOnboarding';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const [onboarding, endOnboarding] = useOnboarding();
  if ((!loaded && !error) || onboarding === null) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {onboarding ? <Onboarding onDone={endOnboarding} /> : (
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }}>
        <Stack.Screen name="index" options={{ title: 'Branché — bornes de recharge' }} />
        <Stack.Screen name="session" options={{ title: 'Recharge', gestureEnabled: false }} />
        <Stack.Screen name="about" options={{ title: 'À propos', presentation: 'modal' }} />
        <Stack.Screen name="payer" options={{ title: 'Payer la borne' }} />
        <Stack.Screen name="recharge" options={{ title: 'Recharge en cours', gestureEnabled: false }} />
        <Stack.Screen name="recharger" options={{ title: 'Recharger ici' }} />
        <Stack.Screen name="historique" options={{ title: 'Mes recharges' }} />
        <Stack.Screen name="vehicule" options={{ title: 'Mon véhicule', presentation: 'modal' }} />
      </Stack>
      )}
    </SafeAreaProvider>
  );
}
