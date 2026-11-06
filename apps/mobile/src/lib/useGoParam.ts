// « Y aller » depuis une borne non payable (recharger.tsx → /?go=<station>) : itinéraire vers la borne payable la plus
// proche. À appeler dans l'écran carte (index.tsx), juste après useTrip :
//   useGoParam({ byId, setById, ready: !!user || loc === 'denied', plan, setSelectedId });
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import type { Station } from './stations';
import { store } from './store';

export function useGoParam(o: {
  byId: Map<string, Station>;
  setById: (f: (prev: Map<string, Station>) => Map<string, Station>) => void;
  ready: boolean;
  plan: (s: Station) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const params = useLocalSearchParams<{ go?: string }>();
  // Borne retenue par recharger.tsx, lue avant que la carte ne réinitialise la sélection courante
  const pending = useRef<Station | null>(store.current());
  const done = useRef<string | null>(null);
  const { byId, setById, ready, plan, setSelectedId } = o;
  useEffect(() => {
    const id = params.go;
    if (!id || done.current === id || !ready) return;
    const st = byId.get(id) ?? (pending.current?.id === id ? pending.current : null);
    if (!st) return;
    done.current = id;
    if (!byId.has(st.id)) setById((prev) => new Map(prev).set(st.id, st));
    setSelectedId(null);
    plan(st);
  }, [params.go, byId, ready, plan, setById, setSelectedId]);
}
