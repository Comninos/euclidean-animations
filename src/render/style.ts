// Byrne-inspired visual styling: palette, stroke/fill conventions, label
// typography. Pure data/functions — no DOM manipulation here, just the
// values svg.ts and animate.ts consume.

import type { ColorName, Shape, ShapeRole } from '../kernel/types';

export const BYRNE_PALETTE = {
  background: '#FAF3E3',
  black: '#1B1B1B',
  red: '#D13438',
  yellow: '#F1C232',
  blue: '#2E5FA3',
  // "construction" isn't a hue of its own in Byrne's plates — construction
  // lines are thin black guide strokes. We keep it visually distinct (a
  // muted ink tone) and rely mainly on role (opacity/dash/width) to signal it.
  construction: '#6B6459',
} as const;

export type ByrnePalette = Record<keyof typeof BYRNE_PALETTE, string>;

/** Dark-theme counterpart: dark ground, warm paper-white ink, hues nudged
 * lighter where the light-theme values would go muddy on a dark ground. */
export const BYRNE_PALETTE_DARK: ByrnePalette = {
  background: '#1E1E1E',
  black: '#E6E0D3',
  red: '#E05B52',
  yellow: '#F1C232',
  blue: '#6D95D4',
  construction: '#98917F',
};

export interface Theme {
  readonly palette: ByrnePalette;
  /** Accent used by player chrome (active step dot, errors) and — when
   * `accentCurrentStep` is set — by the current step's geometry. */
  readonly accent: string;
  /** When true, elements added by the most recent step render in `accent`
   * (overriding their authored color), so the newest construction always
   * stands out. Elements revert as the construction moves on. Pair with a
   * monochrome palette for a minimal two-tone look. */
  readonly accentCurrentStep?: boolean;
  /** Minimal presentation: thin hairline strokes, no polygon/sector fills,
   * smaller points, and calm entrances (fade instead of pop, no highlight
   * pulse) — plain "platonic" line work. Lines still draw on. */
  readonly minimal?: boolean;
}

// ── Theme registry ────────────────────────────────────────────────────────
// Add a theme here and it is immediately selectable via
// <euclid-player theme="name">, viewer.html?theme=name, and the
// postMessage relay. The default (no attribute) is Byrne light.
const FLEXOKI_ACCENT = 'rgb(192, 62, 53)';

export const THEMES: Readonly<Record<string, Theme>> = {
  dark: {
    palette: BYRNE_PALETTE_DARK,
    accent: BYRNE_PALETTE_DARK.red,
  },
  // Minimal two-tone themes: ink and grey geometry on paper/black grounds,
  // with the current step picked out in red.
  mono: {
    palette: {
      background: '#FFFCF0',
      black: '#0D0C0C',
      red: '#0D0C0C',
      yellow: '#0D0C0C',
      blue: '#0D0C0C',
      construction: '#B7B5AC',
    },
    accent: FLEXOKI_ACCENT,
    accentCurrentStep: true,
    minimal: true,
  },
  'mono-dark': {
    palette: {
      background: '#0D0C0C',
      black: '#CECDC3',
      red: '#CECDC3',
      yellow: '#CECDC3',
      blue: '#CECDC3',
      construction: '#575653',
    },
    accent: FLEXOKI_ACCENT,
    accentCurrentStep: true,
    minimal: true,
  },
};

export const DEFAULT_THEME: Theme = {
  palette: BYRNE_PALETTE,
  accent: BYRNE_PALETTE.red,
};

/** CSS declarations mapping a theme onto the --euclid-* custom
 * properties every rendered shape and the player chrome consume. */
export function themeCssDeclarations(theme: Theme): string {
  return [
    ...Object.entries(theme.palette).map(([name, value]) => `--euclid-${name}: ${value};`),
    `--euclid-accent: ${theme.accent};`,
  ].join('\n    ');
}

/** Colors resolve to CSS custom properties (declared on the player's
 * :host from the palettes above), so switching theme restyles every
 * already-rendered shape instantly without a re-render. */
export function resolveFillOrStroke(color: ColorName): string {
  return `var(--euclid-${color})`;
}

/** Stroke width in SVG user units (the viewBox is in plane units, so this
 * is scaled by the renderer's stroke-width-to-viewBox ratio — see svg.ts). */
export const STROKE_WIDTH = {
  normal: 0.045,
  construction: 0.022,
} as const;

/** Hairline widths used by `minimal` themes (applied via theme CSS). */
export const STROKE_WIDTH_MINIMAL = {
  normal: 0.024,
  construction: 0.013,
  pointRadius: 0.035,
} as const;

export const POINT_RADIUS = 0.05;

export const CONSTRUCTION_OPACITY = 0.45;
export const CONSTRUCTION_DASH = '0.09 0.07';

export const FILL_OPACITY = 0.55;

export const LABEL_FONT_FAMILY = "'Georgia', 'Times New Roman', serif";
export const LABEL_FONT_STYLE = 'italic';
export const LABEL_FONT_SIZE = 0.16; // plane units; scaled with the rest of the drawing
export const LABEL_OFFSET = 0.13; // distance labels sit away from their anchor point

export interface ResolvedStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
  readonly strokeDasharray: string | null;
  readonly fill: string | null;
  readonly fillOpacity: number;
  readonly lineCap: 'round';
  readonly lineJoin: 'round';
}

/** Compute the resolved visual style for a shape, given its color + role.
 * `fillColor` (from `polygon.fill` / `sector.fill`) is used for fills;
 * `shape.color` always drives the stroke. */
export function resolveStyle(
  color: ColorName,
  role: ShapeRole,
  fillColor?: ColorName
): ResolvedStyle {
  const isConstruction = role === 'construction';
  return {
    stroke: resolveFillOrStroke(color),
    strokeWidth: isConstruction ? STROKE_WIDTH.construction : STROKE_WIDTH.normal,
    strokeOpacity: isConstruction ? CONSTRUCTION_OPACITY : 1,
    strokeDasharray: isConstruction ? CONSTRUCTION_DASH : null,
    fill: fillColor ? resolveFillOrStroke(fillColor) : null,
    fillOpacity: FILL_OPACITY,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

/** Convenience: resolve style directly from a resolved kernel Shape. */
export function styleForShape(shape: Shape): ResolvedStyle {
  const fill =
    (shape.kind === 'polygon' || shape.kind === 'sector') && shape.fill ? shape.fill : undefined;
  return resolveStyle(shape.color, shape.role, fill);
}
