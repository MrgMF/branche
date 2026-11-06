// Jetons de design : source unique docs/design/tokens.json (couleurs de l'app, de la carte et du site).
import tokens from '../../../docs/design/tokens.json';

export const colors = tokens.color;
/** Couleurs de la carte MapLibre (src/components/mapHtml.ts). */
export const mapColors = tokens.map;

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const radius = tokens.radius;
export const MIN_TOUCH = tokens.minTouch;
