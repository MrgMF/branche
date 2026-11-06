// Bornes au même endroit (même coordonnées à quelques mètres près, ex. plusieurs stations IRVE sur un même parking) :
// regroupées sur la carte en une pastille « 3 bornes » qui se déploie en éventail au toucher (components/mapHtml.ts).
type P = { id: string; lat: number; lon: number };

const M_PER_DEG = 111_320;

/** Groupes de points distants d'au plus `meters` (transitif), dans l'ordre d'entrée ; groupes de 1 inclus. O(n) par grille. */
export function groupColocated<T extends P>(list: T[], meters = 5): T[][] {
  if (!list.length) return [];
  const lat0 = list[0].lat;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const cell = (p: P) => [Math.floor((p.lon * kx) / meters), Math.floor((p.lat * M_PER_DEG) / meters)] as const;
  const grid = new Map<string, number[]>();
  list.forEach((p, i) => {
    const [x, y] = cell(p);
    const k = `${x},${y}`;
    const a = grid.get(k);
    if (a) a.push(i);
    else grid.set(k, [i]);
  });
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a: P, b: P) => Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * M_PER_DEG) <= meters;
  list.forEach((p, i) => {
    const [x, y] = cell(p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(`${x + dx},${y + dy}`) ?? []) if (j > i && near(p, list[j])) parent[find(j)] = find(i);
  });
  const groups = new Map<number, T[]>();
  list.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  });
  return [...groups.values()];
}
