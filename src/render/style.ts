// Minimal visual styling: palette, stroke conventions, label typography.
// Pure data/functions — no DOM manipulation here, just the values svg.ts
// and animate.ts consume.
//
// Exactly two themes exist: default light (no attribute) and dark
// (theme="dark"). Both are Flexoki-based. Colors resolve via
// var(--euclid-*) custom properties declared on the player's :host (see
// euclid-player.ts), which is what lets a theme switch restyle
// already-rendered shapes instantly without a re-render.

import type { ColorName, Shape, ShapeRole } from '../kernel/types';

export interface Palette {
  readonly background: string;
  readonly black: string;
  readonly construction: string;
  readonly red: string;
  readonly blue: string;
  readonly yellow: string;
  readonly accent: string;
  /** Middle grey for quiet chrome (control glyphs, inactive step dots) —
   * legible on both the light-paper and near-black grounds without reading
   * as UI "furniture". */
  readonly control: string;
}

export const LIGHT_PALETTE: Palette = {
  background: '#FFFCF0',
  black: '#100F0F',
  construction: '#B7B5AC',
  red: '#C03E35',
  blue: '#205EA6',
  yellow: '#AD8301',
  accent: '#C03E35',
  control: '#878580',
};

export const DARK_PALETTE: Palette = {
  background: '#100F0F',
  black: '#CECDC3',
  construction: '#575653',
  red: '#C03E35',
  blue: '#4385BE',
  yellow: '#D0A215',
  accent: '#C03E35',
  control: '#878580',
};

/** CSS custom-property declarations for a palette, applied to :host. */
export function paletteCssDeclarations(palette: Palette): string {
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
  normal: 0.024,
  construction: 0.013,
} as const;

export const POINT_RADIUS = 0.035;

export const CONSTRUCTION_OPACITY = 0.45;
export const CONSTRUCTION_DASH = '0.09 0.07';

export const LABEL_FONT_FAMILY = "'Georgia', 'Times New Roman', serif";
export const LABEL_FONT_STYLE = 'italic';
export const LABEL_FONT_SIZE = 0.16; // plane units; scaled with the rest of the drawing
export const LABEL_OFFSET = 0.13; // distance labels sit away from their anchor point

export interface ResolvedStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeOpacity: number;
  readonly strokeDasharray: string | null;
  readonly lineCap: 'round';
  readonly lineJoin: 'round';
}

/** Compute the resolved visual style for a shape, given its color + role.
 * All shapes render stroke-only (points fill with their stroke color,
 * handled separately in svg.ts). */
export function resolveStyle(color: ColorName, role: ShapeRole): ResolvedStyle {
  const isConstruction = role === 'construction';
  return {
    stroke: resolveFillOrStroke(color),
    strokeWidth: isConstruction ? STROKE_WIDTH.construction : STROKE_WIDTH.normal,
    // 'hidden' keeps the shape in the scene (ids stay referenceable, and
    // un-hiding crossfades back) but draws nothing — used to remove
    // scaffolding entirely once it has served its purpose, the way
    // Byrne's plates simply omit cited sub-constructions.
    strokeOpacity: role === 'hidden' ? 0 : isConstruction ? CONSTRUCTION_OPACITY : 1,
    strokeDasharray: isConstruction ? CONSTRUCTION_DASH : null,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

/** Opacity for a shape's label (and a point's solid fill) under a role. */
export function roleFillOpacity(role: ShapeRole): number {
  return role === 'hidden' ? 0 : 1;
}

/** Convenience: resolve style directly from a resolved kernel Shape. */
export function styleForShape(shape: Shape): ResolvedStyle {
  return resolveStyle(shape.color, shape.role);
}
