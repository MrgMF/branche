// Écran maintenu allumé pendant le guidage (iOS / Android).
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const TAG = 'branche-guidage';

export async function keepScreenOn(on: boolean): Promise<boolean> {
  try {
    if (on) await activateKeepAwakeAsync(TAG);
    else deactivateKeepAwake(TAG);
    return true;
  } catch {
    return false;
  }
}
