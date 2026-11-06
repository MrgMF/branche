// Recherche tolérante de modèles (« megane », « model 3 », « zoe », « id3 », fautes de frappe) — pure (vehicleSearch.test.ts).
import { VEHICLES, type VehicleModel } from './vehicle';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (s: string) => fold(s).replace(/ /g, '');

function close(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length] <= max;
}

/** Score de correspondance (0 = aucune). */
function score(m: VehicleModel, q: string): number {
  const name = fold(m.name);
  const words = name.split(' ');
  const tokens = fold(q).split(' ').filter(Boolean);
  if (!tokens.length) return 1;
  if (compact(m.name).includes(compact(q))) return 100 - name.indexOf(tokens[0]);
  let s = 0;
  for (const t of tokens) {
    if (words.some((w) => w.startsWith(t))) s += 10;
    else if (t.length >= 4 && words.some((w) => close(w.slice(0, t.length + 1), t, t.length >= 6 ? 2 : 1) || close(w, t, t.length >= 6 ? 2 : 1))) s += 6;
    else return 0;
  }
  return s;
}

export function searchVehicles(q: string, list: VehicleModel[] = VEHICLES, limit = 40): VehicleModel[] {
  if (!q.trim()) return list.slice(0, limit);
  return list
    .map((m) => ({ m, s: score(m, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);
}
