// Renvoi des retours communautaires saisis hors ligne : au lancement, au retour au premier plan, au retour du réseau
// (événement « online » du navigateur) et toutes les minutes tant que la file n'est pas vide.
import { AppState, Platform } from 'react-native';
import { flushCheckins, pendingCheckins } from './community';

export function startCheckinSync(): () => void {
  const flush = () => void flushCheckins().catch(() => undefined);
  flush();
  const app = AppState.addEventListener('change', (s) => s === 'active' && flush());
  const online = () => flush();
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', online);
  const timer = setInterval(() => {
    pendingCheckins().then((n) => n > 0 && flush());
  }, 60_000);
  return () => {
    app.remove();
    clearInterval(timer);
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', online);
  };
}
