// « Prendre en photo » : photo réduite sur l'appareil (≤ 1024 px, JPEG) puis POST /v1/vehicle/identify.
// L'image n'est jamais enregistrée par Branché (ni sur l'appareil, ni sur le serveur).
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { API_URL } from './config';

export type PhotoResult = { vehicleId: string | null; confidence: 'haute' | 'moyenne' | 'faible' } | { error: string } | null;

export async function photoIdentify(): Promise<PhotoResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
  const shot =
    perm?.granted !== false
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 }).catch(() => null)
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 }).catch(() => null);
  if (!shot || shot.canceled || !shot.assets?.[0]) return null;
  const small = await ImageManipulator.manipulateAsync(shot.assets[0].uri, [{ resize: { width: 1024 } }], {
    compress: 0.6,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  const image = (small.base64 ?? '').replace(/^data:image\/\w+;base64,/, '');
  if (!image) return { error: 'Photo illisible.' };
  if ((image.length * 3) / 4 > 1.5 * 1024 * 1024) return { error: 'Photo trop lourde.' };
  try {
    const r = await fetch(`${API_URL}/v1/vehicle/identify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, mediaType: 'image/jpeg' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (j as { error?: { message?: string } }).error?.message ?? 'Reconnaissance impossible.' };
    return j as PhotoResult;
  } catch {
    return { error: 'Connexion impossible : choisissez votre modèle dans la liste.' };
  }
}
