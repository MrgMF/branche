// Photos de tickets sur le web : IndexedDB (quota bien plus large qu'AsyncStorage/localStorage), jamais envoyées.
// En natif : ticketBlob.native.ts (fichiers). Les tests injectent un magasin en mémoire (ticket.ts setTicketBlobs).

/** Stockage de l'image d'un ticket ; la référence renvoyée par `put` est la seule chose gardée dans AsyncStorage. */
export interface TicketBlobStore {
  /** Enregistre l'image (data URI JPEG) ; renvoie une référence, ou lève une erreur (quota, stockage indisponible). */
  put(id: string, dataUri: string): Promise<string>;
  /** URI affichable (data URI sur le web, file:// en natif), null si l'image n'existe plus. */
  get(ref: string): Promise<string | null>;
  del(ref: string): Promise<void>;
}

const DB = 'branche-tickets';
const STORE = 'tickets';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponible'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB (quota ?)'));
    });
  } finally {
    db.close();
  }
}

const keyOf = (ref: string) => (ref.startsWith('idb:') ? ref.slice(4) : null);

export const ticketBlobs: TicketBlobStore = {
  async put(id, dataUri) {
    await run('readwrite', (s) => s.put(dataUri, id));
    return `idb:${id}`;
  },
  async get(ref) {
    const k = keyOf(ref);
    if (!k) return null;
    const v = await run<unknown>('readonly', (s) => s.get(k));
    return typeof v === 'string' ? v : null;
  },
  async del(ref) {
    const k = keyOf(ref);
    if (k) await run('readwrite', (s) => s.delete(k));
  },
};
