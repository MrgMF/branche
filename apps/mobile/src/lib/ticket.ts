// Photo du ticket de recharge : stockée UNIQUEMENT sur l'appareil (AsyncStorage, image réduite en JPEG), jamais envoyée.
// Une clé par recharge ; supprimée avec la recharge ou à la demande.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'branche.ticket.v1.';
/** Taille maximale stockée (data URI) : ~ 700 Ko. */
export const TICKET_MAX_CHARS = 950_000;

export const ticketKey = (recordId: string) => `${PREFIX}${recordId}`;

/** false si l'image est invalide, trop lourde ou si le stockage est plein. */
export async function saveTicket(recordId: string, dataUri: string): Promise<boolean> {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUri) || dataUri.length > TICKET_MAX_CHARS) return false;
  try {
    await AsyncStorage.setItem(ticketKey(recordId), dataUri);
    return true;
  } catch {
    return false;
  }
}

export async function loadTicket(recordId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ticketKey(recordId));
  } catch {
    return null;
  }
}

export async function removeTicket(recordId: string): Promise<void> {
  await AsyncStorage.removeItem(ticketKey(recordId)).catch(() => undefined);
}
