// Photos de tickets en natif : un fichier JPEG par recharge dans le dossier documents de l'app (expo-file-system),
// jamais envoyé. La référence gardée dans AsyncStorage est relative (« fs:<nom> ») : le chemin absolu du conteneur
// iOS change d'une mise à jour à l'autre.
import { Directory, File, Paths } from 'expo-file-system';
import type { TicketBlobStore } from './ticketBlob';

const DIR = 'tickets';
const safe = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
const fileOf = (ref: string) => (ref.startsWith('fs:') ? new File(Paths.document, DIR, ref.slice(3)) : null);

export const ticketBlobs: TicketBlobStore = {
  async put(id, dataUri) {
    const b64 = dataUri.replace(/^data:image\/\w+;base64,/, '');
    const dir = new Directory(Paths.document, DIR);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const name = `${safe(id)}.jpg`;
    const f = new File(dir, name);
    if (f.exists) f.delete();
    f.create();
    f.write(b64, { encoding: 'base64' });
    return `fs:${name}`;
  },
  async get(ref) {
    const f = fileOf(ref);
    return f?.exists ? f.uri : null;
  },
  async del(ref) {
    const f = fileOf(ref);
    if (f?.exists) f.delete();
  },
};
