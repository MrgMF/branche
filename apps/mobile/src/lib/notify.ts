// Notifications locales — WEB : API Notification du navigateur si l'utilisateur l'autorise, sinon rien.
// (Version native : notify.native.ts, expo-notifications.) Les rappels web ne sonnent que si l'onglet reste ouvert.
export interface Alert {
  at: number;
  title: string;
  body: string;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let n = 0;

export async function scheduleAlerts(alerts: Alert[]): Promise<string[]> {
  if (typeof window === 'undefined' || !('Notification' in window)) return [];
  try {
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return [];
  } catch {
    return [];
  }
  return alerts
    .filter((a) => a.at > Date.now())
    .map((a) => {
      const id = `web-${++n}`;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          try {
            new Notification(a.title, { body: a.body, tag: id });
          } catch {
            /* navigateur sans notifications hors service worker */
          }
        }, Math.min(a.at - Date.now(), 2 ** 31 - 1)),
      );
      return id;
    });
}

export async function cancelAlerts(ids: string[] | undefined): Promise<void> {
  for (const id of ids ?? []) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
  }
}
