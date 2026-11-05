import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }}>
        <Stack.Screen name="index" options={{ title: 'Branché — bornes de recharge' }} />
        <Stack.Screen name="session" options={{ title: 'Recharge', gestureEnabled: false }} />
        <Stack.Screen name="about" options={{ title: 'À propos', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
