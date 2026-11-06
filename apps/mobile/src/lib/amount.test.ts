import { describe, expect, it } from 'vitest';
import { invalidAmount, parseEuros } from './amount';

describe('parseEuros : ^\\d{1,4}([.,]\\d{1,2})?$ uniquement', () => {
  it.each([
    ['9,80', 9.8],
    ['12.4', 12.4],
    ['0', 0],
    ['50', 50],
    ['9999,99', 9999.99],
    [' 12,40 € ', 12.4],
    ['75€', 75],
  ])('%j → %d', (x, n) => expect(parseEuros(x)).toBe(n));
  it.each(['', ' ', '1e3', '0x10', '-5', '+5', '12,345', '10000', '1 234', '1.234,5', '12,', ',5', '.5', 'Infinity', 'NaN', '12 €50', '€12', '1,2,3', '١٢'])(
    'refusé : %j',
    (x) => expect(parseEuros(x)).toBeNull(),
  );
  it('saisie facultative : vide valide, forme inattendue invalide', () => {
    expect(invalidAmount('')).toBe(false);
    expect(invalidAmount('  ')).toBe(false);
    expect(invalidAmount('1e2')).toBe(true);
    expect(invalidAmount('9,8')).toBe(false);
  });
});
