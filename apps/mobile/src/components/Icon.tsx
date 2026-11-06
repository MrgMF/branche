// Pictogrammes de la coquille (trait 2, viewBox 24), même style que NavIcon.
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme';

export type ShellIcon = 'menu' | 'back' | 'chevron' | 'map' | 'bolt' | 'receipt' | 'car' | 'card' | 'gear' | 'info' | 'qr' | 'check' | 'contactless' | 'phone' | 'wallet';

export function Icon({ name, size = 24, color = colors.ink }: { name: ShellIcon; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === 'menu' ? <Path d="M4 7h16M4 12h16M4 17h16" {...p} /> : null}
      {name === 'back' ? <Path d="M15 5l-7 7 7 7" {...p} strokeWidth={2.4} /> : null}
      {name === 'chevron' ? <Path d="M9 5l7 7-7 7" {...p} /> : null}
      {name === 'map' ? <Path d="M9 4L3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5 9 4zM9 4v13.5M15 6.5V20" {...p} /> : null}
      {name === 'bolt' ? <Path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" {...p} /> : null}
      {name === 'receipt' ? <Path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3" {...p} /> : null}
      {name === 'car' ? (
        <>
          <Path d="M5 16V11l2-5h10l2 5v5M3 11h18v6H3zM6.5 17v2M17.5 17v2" {...p} />
          <Circle cx={7.5} cy={14} r={1} fill={color} />
          <Circle cx={16.5} cy={14} r={1} fill={color} />
        </>
      ) : null}
      {name === 'card' ? (
        <>
          <Rect x={3} y={5.5} width={18} height={13} rx={2.5} {...p} />
          <Path d="M3 10h18M7 15h4" {...p} />
        </>
      ) : null}
      {name === 'gear' ? (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" {...p} />
        </>
      ) : null}
      {name === 'info' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 11v6M12 7.5v.2" {...p} strokeWidth={2.4} />
        </>
      ) : null}
      {name === 'qr' ? <Path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18v2M18 18h2v2" {...p} /> : null}
      {name === 'check' ? <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} strokeWidth={2.4} /> : null}
      {/* Moyens de paiement : pictogrammes génériques (jamais de logo de marque) */}
      {name === 'contactless' ? <Path d="M7 8.5a5 5 0 010 7M11 6a8.5 8.5 0 010 12M15 3.5a12 12 0 010 17" {...p} /> : null}
      {name === 'phone' ? (
        <>
          <Rect x={6.5} y={2.5} width={11} height={19} rx={2.5} {...p} />
          <Path d="M10.5 18.5h3" {...p} />
        </>
      ) : null}
      {name === 'wallet' ? (
        <>
          <Path d="M4 7.5h14.5a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18V7.5zM4 7.5l11-3v3" {...p} />
          <Circle cx={16} cy={13.5} r={1} fill={color} />
        </>
      ) : null}
    </Svg>
  );
}
