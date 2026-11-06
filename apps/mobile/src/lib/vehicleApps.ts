// Applis constructeur détectables (liste fermée et sourcée) → marque proposée. Détection 100 % locale.
import apps from './vehicle-apps.json';
import { VEHICLES, type VehicleModel } from './vehicle';

export interface BrandApp {
  brand: string;
  prefix: string;
  package: string;
  source: string;
}
export const ANDROID_BRAND_APPS: BrandApp[] = apps.android;
export const IOS_BRAND_SCHEMES: { brand: string; prefix: string; scheme: string }[] = apps.iosSchemes;
export const modelsOfBrand = (prefix: string): VehicleModel[] => VEHICLES.filter((m) => m.id.startsWith(prefix));
