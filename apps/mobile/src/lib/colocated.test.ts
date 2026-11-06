import { describe, expect, it } from 'vitest';
import { groupColocated } from './colocated';

const at = (id: string, dLatM: number, dLonM = 0) => ({ id, lat: 48.8566 + dLatM / 111_320, lon: 2.3522 + dLonM / (111_320 * Math.cos((48.8566 * Math.PI) / 180)) });

describe('groupColocated', () => {
  it('regroupe les bornes à moins de 5 m, garde les autres seules', () => {
    const g = groupColocated([at('a', 0), at('b', 2), at('c', 0, 3), at('d', 40), at('e', 41.5)]);
    expect(g.map((x) => x.map((p) => p.id))).toEqual([['a', 'b', 'c'], ['d', 'e']]);
  });
  it('au-delà de 5 m : séparées', () => {
    expect(groupColocated([at('a', 0), at('b', 8)])).toHaveLength(2);
    expect(groupColocated([])).toEqual([]);
  });
});
