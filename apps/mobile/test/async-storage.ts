// AsyncStorage en mémoire pour les tests unitaires (vitest, Node). `failWrites(true)` simule un stockage plein.
const mem = new Map<string, string>();
let fail = false;
export const failWrites = (on: boolean) => {
  fail = on;
};
const guard = () => {
  if (fail) throw new Error('QuotaExceededError (test)');
};
export default {
  getItem: async (k: string) => mem.get(k) ?? null,
  setItem: async (k: string, v: string) => {
    guard();
    mem.set(k, v);
  },
  removeItem: async (k: string) => {
    guard();
    mem.delete(k);
  },
  clear: async () => mem.clear(),
};
