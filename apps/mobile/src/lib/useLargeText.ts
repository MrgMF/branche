import { useWindowDimensions } from 'react-native';

/**
 * Texte agrandi : taille de police système ≥ 130 % (iOS/Android) ou fenêtre très étroite (zoom ×2 du navigateur,
 * ~195 px CSS sur un téléphone). Les tuiles de chiffres s'empilent et les titres passent sur plusieurs lignes.
 */
export function useLargeText(): boolean {
  const { fontScale, width } = useWindowDimensions();
  return fontScale >= 1.3 || width < 300;
}
