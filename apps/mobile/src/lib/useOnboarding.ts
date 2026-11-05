// Premier lancement : faut-il montrer la présentation ? (mémorisé sur l'appareil)
// Les navigateurs pilotés par des tests automatisés (navigator.webdriver) la sautent, sauf avec ?bienvenue=1.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

const KEY = 'branche.onboarded.v1';

function automated(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const forced = typeof location !== 'undefined' && /[?&]bienvenue=1\b/.test(location.search);
  return !!(navigator as Navigator & { webdriver?: boolean }).webdriver && !forced;
}

/** [true : à montrer | false : déjà vue | null : lecture en cours, terminer] */
export function useOnboarding(): [boolean | null, () => void] {
  const [show, setShow] = useState<boolean | null>(automated() ? false : null);
  useEffect(() => {
    if (show === false) return;
    AsyncStorage.getItem(KEY)
      .then((v) => setShow(v !== '1'))
      .catch(() => setShow(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const done = useCallback(() => {
    setShow(false);
    AsyncStorage.setItem(KEY, '1').catch(() => undefined);
  }, []);
  return [show, done];
}
