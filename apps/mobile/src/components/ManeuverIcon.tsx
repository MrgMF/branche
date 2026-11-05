// Icônes de manœuvre dessinées en vecteurs (react-native-svg), lisibles d'un coup d'œil.
import Svg, { Circle, G, Path, Polygon, Text as SvgText } from 'react-native-svg';
import type { LaneDir, Maneuver } from '../lib/navigation';

type Pt = [number, number];
const SW = 11; // épaisseur du trait (viewBox 100)

/** Pointe de flèche en bout de trait : `end` = fin du trait, `dir` = direction (normalisée ici). */
function head(end: Pt, dir: Pt, color: string, size = 1) {
  const n = Math.hypot(dir[0], dir[1]) || 1;
  const d: Pt = [dir[0] / n, dir[1] / n];
  const p: Pt = [-d[1], d[0]];
  const L = 20 * size;
  const W = 15 * size;
  const tip: Pt = [end[0] + d[0] * (L - 4 * size), end[1] + d[1] * (L - 4 * size)];
  const base: Pt = [end[0] - d[0] * 4 * size, end[1] - d[1] * 4 * size];
  const pts = [tip, [base[0] + p[0] * W, base[1] + p[1] * W], [base[0] - p[0] * W, base[1] - p[1] * W]].map((x) => x.join(',')).join(' ');
  return <Polygon points={pts} fill={color} strokeLinejoin="round" stroke={color} strokeWidth={2} />;
}

interface Shape {
  faded?: string[];
  path: string;
  end: Pt;
  dir: Pt;
}

// Formes « à droite » ; les variantes gauches sont obtenues par symétrie.
const SHAPES: Record<string, Shape> = {
  straight: { path: 'M50 90 V34', end: [50, 34], dir: [0, -1] },
  'turn-right': { path: 'M36 90 V54 Q36 38 52 38 H62', end: [62, 38], dir: [1, 0] },
  'slight-right': { path: 'M42 90 V62 L60 38', end: [60, 38], dir: [18, -24] },
  'sharp-right': { path: 'M38 90 V34 L58 56', end: [58, 56], dir: [20, 22] },
  uturn: { path: 'M66 90 V46 A17 17 0 0 0 32 46 V60', end: [32, 60], dir: [0, 1] },
  'keep-right': { faded: ['M44 90 V60 L28 34'], path: 'M44 90 V60 L60 38', end: [60, 38], dir: [16, -22] },
  'exit-right': { faded: ['M36 90 V12'], path: 'M36 90 V64 Q36 50 52 42 L58 38', end: [58, 38], dir: [12, -9] },
  merge: { faded: ['M28 90 Q28 64 50 52'], path: 'M72 90 Q72 64 50 52 V34', end: [50, 34], dir: [0, -1] },
};

const MIRROR: Partial<Record<Maneuver, string>> = {
  'turn-left': 'turn-right',
  'slight-left': 'slight-right',
  'sharp-left': 'sharp-right',
  'keep-left': 'keep-right',
  'exit-left': 'exit-right',
};

/** Angle de sortie par défaut d'un giratoire à 4 branches quand le fournisseur n'en donne pas. */
const defaultExitAngle = (exit?: number) => (exit === 1 ? 90 : exit === 2 ? 0 : exit === 3 ? -90 : exit ? -150 : 0);

function Roundabout({ exit, angle, color, faded }: { exit?: number; angle?: number; color: string; faded: string }) {
  // Sens de circulation français (anti-horaire vu du dessus) : entrée en bas, sortie à l'angle donné.
  const a = typeof angle === 'number' ? angle : defaultExitAngle(exit);
  const C: Pt = [50, 46];
  const r = 19;
  const rad = (a * Math.PI) / 180;
  const u: Pt = [Math.sin(rad), -Math.cos(rad)];
  const E: Pt = [C[0] + u[0] * r, C[1] + u[1] * r];
  const B: Pt = [C[0], C[1] + r];
  let sweep = 180 - a;
  if (sweep <= 10) sweep += 360 - 20; // demi-tour au giratoire
  const large = sweep > 180 ? 1 : 0;
  const armEnd: Pt = [E[0] + u[0] * 15, E[1] + u[1] * 15];
  return (
    <>
      <Circle cx={C[0]} cy={C[1]} r={r} stroke={faded} strokeWidth={SW - 2} fill="none" />
      <Path
        d={`M50 92 V${B[1]} A${r} ${r} 0 ${large} 0 ${E[0].toFixed(1)} ${E[1].toFixed(1)} L${armEnd[0].toFixed(1)} ${armEnd[1].toFixed(1)}`}
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {head(armEnd, u, color, 0.85)}
      {exit ? (
        <SvgText x={C[0]} y={C[1] + 7} fontSize={22} fontWeight="700" fill={color} textAnchor="middle">
          {String(exit)}
        </SvgText>
      ) : null}
    </>
  );
}

export function ManeuverIcon(props: { maneuver: Maneuver; exit?: number; angle?: number; size?: number; color?: string; faded?: string; label?: string }) {
  const color = props.color ?? '#FFFFFF';
  const faded = props.faded ?? 'rgba(255,255,255,0.35)';
  const size = props.size ?? 72;
  const m = props.maneuver;
  let body: React.ReactNode;
  if (m === 'roundabout') body = <Roundabout exit={props.exit} angle={props.angle} color={color} faded={faded} />;
  else if (m === 'arrive' || m === 'waypoint') {
    body = (
      <>
        <Path d="M50 92 C50 92 24 62 24 42 A26 26 0 0 1 76 42 C76 62 50 92 50 92 Z" fill={color} />
        <Circle cx={50} cy={42} r={10} fill={props.color ? '#FFFFFF' : '#0F1A17'} />
      </>
    );
  } else {
    const key = MIRROR[m] ?? (m === 'depart' || m === 'ferry' ? 'straight' : m);
    const s = SHAPES[key] ?? SHAPES.straight;
    const inner = (
      <>
        {s.faded?.map((d) => <Path key={d} d={d} stroke={faded} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        <Path d={s.path} stroke={color} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {head(s.end, s.dir, color)}
        {m === 'depart' ? <Circle cx={50} cy={90} r={9} fill={color} /> : null}
      </>
    );
    body = MIRROR[m] ? <G transform="translate(100,0) scale(-1,1)">{inner}</G> : inner;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityRole="image" accessibilityLabel={props.label}>
      {body}
    </Svg>
  );
}

/** Branches d'une flèche de voie, depuis un tronc commun (50,92)→(50,56) : [tracé, fin, direction]. */
const LANE_BRANCH: Record<LaneDir, [string, Pt, Pt]> = {
  straight: ['M50 56 V30', [50, 30], [0, -1]],
  'slight-left': ['M50 60 L32 36', [32, 36], [-18, -24]],
  'slight-right': ['M50 60 L68 36', [68, 36], [18, -24]],
  left: ['M50 60 Q50 44 36 44 H28', [28, 44], [-1, 0]],
  right: ['M50 60 Q50 44 64 44 H72', [72, 44], [1, 0]],
  'sharp-left': ['M50 50 L30 68', [30, 68], [-20, 18]],
  'sharp-right': ['M50 50 L70 68', [70, 68], [20, 18]],
  'uturn-left': ['M50 56 V44 A13 13 0 0 0 24 44 V58', [24, 58], [0, 1]],
  'uturn-right': ['M50 56 V44 A13 13 0 0 1 76 44 V58', [76, 58], [0, 1]],
  'merge-left': ['M50 60 L32 36', [32, 36], [-18, -24]],
  'merge-right': ['M50 60 L68 36', [68, 36], [18, -24]],
};

/** Flèche d'une voie : tronc commun et une branche par direction peinte. */
export function LaneArrow({ dirs, active, size = 34 }: { dirs: LaneDir[]; active: boolean; size?: number }) {
  const color = active ? '#FFFFFF' : 'rgba(255,255,255,0.38)';
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M50 92 V56" stroke={color} strokeWidth={SW + 1} strokeLinecap="round" fill="none" />
      {dirs.map((d) => {
        const [path, end, dir] = LANE_BRANCH[d];
        return (
          <G key={d}>
            <Path d={path} stroke={color} strokeWidth={SW + 1} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {head(end, dir, color, 0.95)}
          </G>
        );
      })}
    </Svg>
  );
}

type IconName = 'voice-on' | 'voice-off' | 'report' | 'share' | 'close' | 'search' | 'history' | 'bolt' | 'routes';

/** Pictogrammes d'interface (trait 2, viewBox 24). */
export function NavIcon({ name, size = 24, color = '#0F1A17' }: { name: IconName; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'voice-on' || name === 'voice-off' ? <Path d="M4 9v6h4l5 4V5L8 9H4z" {...p} fill={color} /> : null}
      {name === 'voice-on' ? <Path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" {...p} /> : null}
      {name === 'voice-off' ? <Path d="M16 9l6 6M22 9l-6 6" {...p} /> : null}
      {name === 'report' ? (
        <>
          <Path d="M12 3L2 20h20L12 3z" {...p} />
          <Path d="M12 10v4.5M12 17.4v.2" {...p} />
        </>
      ) : null}
      {name === 'share' ? <Path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" {...p} /> : null}
      {name === 'close' ? <Path d="M6 6l12 12M18 6L6 18" {...p} /> : null}
      {name === 'search' ? <Path d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21" {...p} /> : null}
      {name === 'history' ? <Path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" {...p} /> : null}
      {name === 'bolt' ? <Path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" {...p} fill={color} /> : null}
      {name === 'routes' ? <Path d="M6 21V9a4 4 0 0 1 4-4h8M15 2l3 3-3 3M6 15h6a4 4 0 0 0 4-4" {...p} /> : null}
    </Svg>
  );
}
