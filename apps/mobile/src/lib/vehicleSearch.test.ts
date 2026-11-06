import { describe, expect, it } from 'vitest';
import { searchVehicles } from './vehicleSearch';

const first = (q: string) => searchVehicles(q)[0]?.id;

describe('searchVehicles (saisie rapide tolérante)', () => {
  it.each([
    ['megane', 'renault-megane-60'],
    ['Mégane', 'renault-megane-60'],
    ['megnae', 'renault-megane-60'],
    ['zoe', 'renault-zoe-52'],
    ['id3', 'vw-id3-58'],
    ['spring', 'dacia-spring'],
    ['e208', 'peugeot-e208'],
    ['ioniq', 'hyundai-ioniq5-77'],
  ])('%s → %s', (q, id) => expect(first(q)).toBe(id));
  it('« model 3 » : les deux Model 3, pas de Model Y', () => {
    const r = searchVehicles('model 3').map((m) => m.id);
    expect(r.slice(0, 2).sort()).toEqual(['tesla-m3-lr', 'tesla-m3-rwd']);
    expect(r).not.toContain('tesla-my-rwd');
  });
  it('vide → tout ; inconnu → rien', () => {
    expect(searchVehicles('').length).toBeGreaterThan(25);
    expect(searchVehicles('lamborghini')).toEqual([]);
  });
});
