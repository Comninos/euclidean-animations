// TS types for the declarative proposition JSON format.
//
// ── Intersection `pick` convention ──────────────────────────────────────
// Any op that can have two solutions (circle-circle, line-circle) selects
// one via `"pick": 0 | 1`, using this fixed deterministic order:
//
//   circle-circle: let d = center(second circle) - center(first circle).
//     pick 0 = the intersection point to the LEFT of d (reached by rotating
//     d +90 degrees / counter-clockwise into the intersection half-plane).
//     pick 1 = the mirror point on the right of d.
//     Example: centers A=(-1,0), B=(1,0) (so d points in +x), radius 2 each
//     -> pick 0 = (0, +sqrt(3)) (above the AB line), pick 1 = (0, -sqrt(3)).
//
//   line-circle: points are ordered by walking along the line's direction
//     vector (from -> to, or origin -> through for a ray); pick 0 is the
//     solution met first (smaller parameter t), pick 1 is met second.
//
//   line-line: always exactly one solution; `pick` must be 0.
//
// This convention is implemented in `src/kernel/ops.ts` and locked in by
// `tests/ops.test.ts`.

import type { ColorName, ShapeRole } from '../kernel/types';

/** [x, y] tuple, math convention (y-up), used for literal coordinates in JSON. */
export type Coords = readonly [number, number];

interface AddOpBase {
  readonly id: string;
  readonly label?: string;
  readonly color?: ColorName;
}

export interface PointAddOp extends AddOpBase {
  readonly op: 'point';
  /** Literal coordinates. Omit only if `id` refers to a `given` point. */
  readonly at?: Coords;
}

export interface SegmentAddOp extends AddOpBase {
  readonly op: 'segment';
  readonly from: string;
  readonly to: string;
}

export interface LineAddOp extends AddOpBase {
  readonly op: 'line';
  readonly a: string;
  readonly b: string;
}

export interface RayAddOp extends AddOpBase {
  readonly op: 'ray';
  readonly origin: string;
  readonly through: string;
}

export interface CircleAddOp extends AddOpBase {
  readonly op: 'circle';
  readonly center: string;
  /** The point the compass radius is drawn to/from; also the arc-sweep start. */
  readonly through: string;
}

/** Intersect two previously-added shapes (by id), selecting one of up to
 * two solutions with `pick`. See file header for the pick-order convention. */
export interface IntersectAddOp extends AddOpBase {
  readonly op: 'intersect';
  readonly of: readonly [string, string];
  readonly pick: 0 | 1;
}

export interface MidpointAddOp extends AddOpBase {
  readonly op: 'midpoint';
  readonly a: string;
  readonly b: string;
}

/** A point at an absolute distance from `from`, along the direction from `from` to `through`. */
export interface ExtendAddOp extends AddOpBase {
  readonly op: 'extend';
  readonly from: string;
  readonly through: string;
  readonly distance: number;
}

/** A point at an absolute distance from `origin`, in the direction of `through`. */
export interface PointAtDistanceAddOp extends AddOpBase {
  readonly op: 'pointAtDistance';
  readonly origin: string;
  readonly through: string;
  readonly distance: number;
}

export interface FootOfPerpendicularAddOp extends AddOpBase {
  readonly op: 'footOfPerpendicular';
  readonly from: string;
  readonly lineA: string;
  readonly lineB: string;
}

export interface PolygonAddOp extends AddOpBase {
  readonly op: 'polygon';
  readonly of: readonly string[];
  readonly fill?: ColorName;
}

export interface SectorAddOp extends AddOpBase {
  readonly op: 'sector';
  readonly center: string;
  readonly start: string;
  readonly end: string;
  readonly fill?: ColorName;
}

export interface AngleMarkAddOp extends AddOpBase {
  readonly op: 'angleMark';
  readonly vertex: string;
  readonly from: string;
  readonly to: string;
}

export type AddOp =
  | PointAddOp
  | SegmentAddOp
  | LineAddOp
  | RayAddOp
  | CircleAddOp
  | IntersectAddOp
  | MidpointAddOp
  | ExtendAddOp
  | PointAtDistanceAddOp
  | FootOfPerpendicularAddOp
  | PolygonAddOp
  | SectorAddOp
  | AngleMarkAddOp;

export type AddOpKind = AddOp['op'];

/** Restyle one or more existing shapes: demote to construction role, recolor, etc. */
export interface SetOp {
  readonly targets: readonly string[];
  readonly role?: ShapeRole;
  readonly color?: ColorName;
}

/** One logical "beat" of the construction — one step-forward click. */
export interface ProposedStep {
  /** Optional explicit id, used in error messages; defaults to `step[index]`. */
  readonly id?: string;
  /** Caption text shown in the player for this step. */
  readonly text?: string;
  readonly add?: readonly AddOp[];
  readonly set?: readonly SetOp[];
  /** Shape ids to pulse-highlight when this step plays. */
  readonly highlight?: readonly string[];
}

/** The SVG viewBox in abstract plane units (y-up; flipped at render time). */
export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Proposition {
  readonly id: string;
  readonly title: string;
  /** Optional explicit frame. When omitted (the default), the frame is
   * computed from the *final* step's geometry plus padding, so the whole
   * construction fits at every step (see kernel/bounds.ts). */
  readonly view?: ViewBox;
  readonly given: Readonly<Record<string, Coords>>;
  readonly steps: readonly ProposedStep[];
}
