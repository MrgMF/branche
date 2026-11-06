// Export CSV de l'historique (note de frais) : téléchargement sur le web, feuille de partage du système sur téléphone.
// Partagé par l'écran Historique et l'avertissement « Enregistrement impossible » (libérer de la place sans rien perdre).
import { Platform, Share } from 'react-native';
import { loadHistory, toCsv } from './history';
import { tr } from '../i18n';

/** Exporte l'historique ; renvoie le nom du fichier téléchargé (web), '' après partage (natif), null si vide. */
export async function exportHistoryCsv(): Promise<string | null> {
  const list = await loadHistory();
  if (!list.length) return null;
  const csv = toCsv(list);
  const name = `${tr().history.csvFile}-${new Date().toISOString().slice(0, 10)}.csv`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  }
  // Feuille de partage du système (e-mail, Fichiers, messagerie…) : le CSV en texte.
  await Share.share({ title: name, message: csv }).catch(() => undefined);
  return '';
}
