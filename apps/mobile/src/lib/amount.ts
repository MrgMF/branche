// Saisie d'un montant ou d'une quantité (« 12,40 », « 9.8 », « 50 € ») — fonction pure, testée dans amount.test.ts.
// Seule forme acceptée : 1 à 4 chiffres, puis éventuellement une virgule ou un point et 1 ou 2 décimales.
// Rien d'autre (signe, exposant, « 1e3 », « 0x10 », séparateur de milliers, texte) : la saisie est refusée.
const AMOUNT = /^\d{1,4}([.,]\d{1,2})?$/;

/** Nombre saisi (espaces et « € » final tolérés autour), ou null si la forme n'est pas exactement celle attendue. */
export function parseEuros(x: string): number | null {
  const v = x.trim().replace(/\s*€$/, '').trim();
  if (!AMOUNT.test(v)) return null;
  return Math.round(Number(v.replace(',', '.')) * 100) / 100;
}

/** Saisie facultative : vide = valide ; sinon invalide si parseEuros la refuse. */
export const invalidAmount = (x: string) => x.trim() !== '' && parseEuros(x) == null;
