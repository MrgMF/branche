// Arrivée à une borne → parcours de recharge (écran de l'équipe paiement, sinon paiement direct en repli).
import { router, useRootNavigationState } from 'expo-router';
import { useCallback } from 'react';
import type { Station } from './stations';
import { store } from './store';

type NavState = { routeNames?: string[]; routes?: { state?: NavState }[] };

/** Cherche un écran dans l'arbre de navigation (la racine expo-router enveloppe la pile dans « __root »). */
function hasRoute(s: NavState | undefined, name: string, depth = 0): boolean {
  if (!s || depth > 4) return false;
  if (s.routeNames?.includes(name)) return true;
  return (s.routes ?? []).some((r) => hasRoute(r.state, name, depth + 1));
}

export function useRechargeHere() {
  const state = useRootNavigationState() as NavState | undefined;
  const hasRecharger = hasRoute(state, 'recharger');
  return useCallback(
    (s: Station) => {
      store.setCurrent(s);
      if (hasRecharger) router.push({ pathname: '/recharger', params: { station: s.id } } as never);
      else router.push('/payer');
    },
    [hasRecharger],
  );
}
