// Écran maintenu allumé pendant le guidage (web : Screen Wake Lock API), repris au retour sur l'onglet.
type Sentinel = { release: () => Promise<void>; released?: boolean };
type WakeLockNav = Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };

let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire(): Promise<boolean> {
  const nav = typeof navigator !== 'undefined' ? (navigator as WakeLockNav) : null;
  if (!nav?.wakeLock) return false;
  try {
    sentinel = await nav.wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

function onVisible() {
  if (wanted && document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
}

export async function keepScreenOn(on: boolean): Promise<boolean> {
  wanted = on;
  if (typeof document === 'undefined') return false;
  if (on) {
    document.addEventListener('visibilitychange', onVisible);
    return acquire();
  }
  document.removeEventListener('visibilitychange', onVisible);
  const s = sentinel;
  sentinel = null;
  await s?.release().catch(() => undefined);
  return true;
}
