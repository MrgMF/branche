// Natif : marques des applis constructeur installées. Android : paquets déclarés dans <queries>
// (plugins/withVehicleAppQueries.js), lus avec expo-intent-launcher ; iOS : schémas d'URL confirmés (aucun à ce jour).
// Résultat gardé sur l'appareil, jamais envoyé.
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import { ANDROID_BRAND_APPS, IOS_BRAND_SCHEMES, type BrandApp } from './vehicleApps';

export async function detectBrandApps(): Promise<Pick<BrandApp, 'brand' | 'prefix'>[]> {
  const found: Pick<BrandApp, 'brand' | 'prefix'>[] = [];
  try {
    if (Platform.OS === 'android') {
      for (const a of ANDROID_BRAND_APPS) {
        const icon = await IntentLauncher.getApplicationIconAsync(a.package).catch(() => '');
        if (icon) found.push({ brand: a.brand, prefix: a.prefix });
      }
    } else if (Platform.OS === 'ios') {
      for (const s of IOS_BRAND_SCHEMES) if (await Linking.canOpenURL(`${s.scheme}://`).catch(() => false)) found.push(s);
    }
  } catch {
    /* détection impossible : aucune proposition */
  }
  return found;
}
