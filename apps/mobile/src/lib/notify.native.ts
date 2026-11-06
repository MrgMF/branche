// Notifications locales — NATIF : expo-notifications, programmées à l'avance (sonnent même app fermée).
import * as Notifications from 'expo-notifications';
import type { Alert } from './notify';

export type { Alert } from './notify';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function scheduleAlerts(alerts: Alert[]): Promise<string[]> {
  try {
    const p = await Notifications.getPermissionsAsync();
    const ok = p.granted || (p.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!ok) return [];
    const ids: string[] = [];
    for (const a of alerts) {
      if (a.at <= Date.now()) continue;
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: { title: a.title, body: a.body },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: a.at },
        }),
      );
    }
    return ids;
  } catch {
    return [];
  }
}

export async function cancelAlerts(ids: string[] | undefined): Promise<void> {
  for (const id of ids ?? []) await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
}
