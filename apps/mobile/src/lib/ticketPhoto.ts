// « Photographier le ticket » : appareil photo si autorisé, sinon galerie ; image réduite sur l'appareil (≤ 1200 px,
// JPEG) et renvoyée en data URI pour ticket.ts. Rien n'est envoyé.
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { TICKET_MAX_CHARS } from './ticket';

export type TicketShot = { data: string } | { error: 'unreadable' | 'tooBig' } | null;

export async function takeTicketPhoto(): Promise<TicketShot> {
  const perm = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
  const shot =
    perm?.granted !== false
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 }).catch(() => null)
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 }).catch(() => null);
  if (!shot || shot.canceled || !shot.assets?.[0]) return null;
  const small = await ImageManipulator.manipulateAsync(shot.assets[0].uri, [{ resize: { width: 1200 } }], {
    compress: 0.55,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  }).catch(() => null);
  const b64 = (small?.base64 ?? '').replace(/^data:image\/\w+;base64,/, '');
  if (!b64) return { error: 'unreadable' };
  const data = `data:image/jpeg;base64,${b64}`;
  return data.length > TICKET_MAX_CHARS ? { error: 'tooBig' } : { data };
}
