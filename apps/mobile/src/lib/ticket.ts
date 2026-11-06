// Photo du ticket de recharge : gardée UNIQUEMENT sur l'appareil, jamais envoyée. L'image va dans un fichier (natif,
// expo-file-system) ou dans IndexedDB (web) ; AsyncStorage ne garde qu'une référence par recharge (« {"ref":…} »).
// Supprimée avec la recharge ou à la demande. Ancien format (data URI dans AsyncStorage) encore lu et supprimé.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ticketBlobs, type TicketBlobStore } from './ticketBlob';

const PREFIX = 'branche.ticket.v1.';
/** Taille maximale acceptée (data URI) : ~ 700 Ko. */
export const TICKET_MAX_CHARS = 950_000;

export const ticketKey = (recordId: string) => `${PREFIX}${recordId}`;

let blobs: TicketBlobStore = ticketBlobs;
/** Tests : magasin d'images injecté (Node n'a ni IndexedDB ni système de fichiers Expo). */
export function setTicketBlobs(b: TicketBlobStore) {
  blobs = b;
}

const refOf = (raw: string | null): string | null => {
  if (!raw || raw.startsWith('data:')) return null;
  try {
    const v = JSON.parse(raw) as { ref?: unknown };
    return typeof v.ref === 'string' ? v.ref : null;
  } catch {
    return null;
  }
};

/** false si l'image est invalide, trop lourde, ou si le stockage (fichier/IndexedDB, puis référence) échoue. */
export async function saveTicket(recordId: string, dataUri: string): Promise<boolean> {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUri) || dataUri.length > TICKET_MAX_CHARS) return false;
  let ref: string;
  try {
    ref = await blobs.put(recordId, dataUri);
  } catch {
    return false;
  }
  try {
    await AsyncStorage.setItem(ticketKey(recordId), JSON.stringify({ ref }));
    return true;
  } catch {
    await blobs.del(ref).catch(() => undefined); // pas d'image orpheline
    return false;
  }
}

/** URI affichable de la photo, ou null (supprimée, illisible). */
export async function loadTicket(recordId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(ticketKey(recordId));
    if (raw?.startsWith('data:image/')) return raw; // ancien format
    const ref = refOf(raw);
    return ref ? await blobs.get(ref) : null;
  } catch {
    return null;
  }
}

export async function removeTicket(recordId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(ticketKey(recordId)).catch(() => null);
  const ref = refOf(raw);
  if (ref) await blobs.del(ref).catch(() => undefined);
  await AsyncStorage.removeItem(ticketKey(recordId)).catch(() => undefined);
}
