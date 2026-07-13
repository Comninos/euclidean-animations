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

/** CSS declarations mapping a palette onto the --euclid-* custom
 * properties every rendered shape and the player chrome consume. */
export function paletteCssDeclarations(palette: ByrnePalette): string {
  return Object.entries(palette)
    .map(([name, value]) => `--euclid-${name}: ${value};`)
    .join('\n    ');
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
