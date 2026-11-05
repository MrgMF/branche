// Arrivée à une borne → parcours de recharge (écran de l'équipe paiement, sinon paiement direct en repli).
import { router, useRootNavigationState } from 'expo-router';
import { useCallback } from 'react';
import type { Station } from './stations';
import { store } from './store';

export function useRechargeHere() {
  const state = useRootNavigationState() as { routeNames?: string[] } | undefined;
  const hasRecharger = !!state?.routeNames?.includes('recharger');
  return useCallback(
    (s: Station) => {
      store.setCurrent(s);
      if (hasRecharger) router.push({ pathname: '/recharger', params: { station: s.id } } as never);
      else router.push('/payer');
    },
    [hasRecharger],
  );
}
