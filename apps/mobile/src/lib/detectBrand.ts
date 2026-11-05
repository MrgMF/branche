// Web : aucune détection possible des applis installées (renvoie une liste vide, sans erreur).
import type { BrandApp } from './vehicleApps';

export async function detectBrandApps(): Promise<Pick<BrandApp, 'brand' | 'prefix'>[]> {
  return [];
}
