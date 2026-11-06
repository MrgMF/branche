// Premier lancement : faut-il montrer la présentation ? (mémorisé sur l'appareil ; « Revoir la présentation » dans Réglages)
// Les navigateurs pilotés par des tests automatisés (navigator.webdriver) la sautent, sauf avec ?bienvenue=1.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

const KEY = 'branche.onboarded.v1';
const replay = new Set<() => void>();

function automated(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const forced = typeof location !== 'undefined' && /[?&]bienvenue=1\b/.test(location.search);
  return !!(navigator as Navigator & { webdriver?: boolean }).webdriver && !forced;
}

/** Réaffiche la présentation (Réglages). */
export function showOnboardingAgain(): void {
  replay.forEach((l) => l());
}

/** [true : premier lancement | 'replay' : revue depuis Réglages (par-dessus l'app) | false : déjà vue | null : lecture en cours, terminer] */
export function useOnboarding(): [boolean | 'replay' | null, () => void] {
  const [show, setShow] = useState<boolean | 'replay' | null>(automated() ? false : null);
  useEffect(() => {
    const again = () => setShow('replay');
    replay.add(again);
    if (show !== false)
      AsyncStorage.getItem(KEY)
        .then((v) => setShow(v !== '1'))
        .catch(() => setShow(false));
    return () => {
      replay.delete(again);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const done = useCallback(() => {
    setShow(false);
    AsyncStorage.setItem(KEY, '1').catch(() => undefined);
  }, []);
  return [show, done];
}
