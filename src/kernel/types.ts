// Pure geometry data types. No DOM. All shapes are plain data so the
// evaluator and renderer stay fully decoupled from each other.
//
// Coordinate convention: math-style, y-up. The abstract plane has no
// relationship to screen/SVG pixels; `src/render/svg.ts` is responsible
// for flipping the y-axis when it maps a `view` box to an SVG viewBox.

/** A 2D point in the abstract construction plane (y-up). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Named color roles that map through the theme palette (see render/style.ts). */
export type ColorName = 'black' | 'red' | 'yellow' | 'blue' | 'construction';

/** Visual "role" a shape can be demoted/promoted to via a `set` step. */
export type ShapeRole = 'normal' | 'construction' | 'hidden';

/** Compass side for an author-placed label (y-up plane). */
export type LabelSide = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

interface ShapeBase {
  readonly id: string;
  readonly color: ColorName;
  readonly role: ShapeRole;
  readonly label?: string;
  readonly labelSide?: LabelSide;
  /** Explicit plane-space offset from the shape's label anchor (y-up). */
  readonly labelOffset?: Point;
}

/** A resolved point shape: a labeled dot at a concrete location. */
export interface PointShape extends ShapeBase {
  readonly kind: 'point';
  readonly at: Point;
}

/** An infinite line, represented by two distinct points it passes through. */
export interface LineShape extends ShapeBase {
  readonly kind: 'line';
  readonly a: Point;
  readonly b: Point;
}

/** A ray starting at `origin`, passing through `through`, extending beyond it. */
export interface RayShape extends ShapeBase {
  readonly kind: 'ray';
  readonly origin: Point;
  readonly through: Point;
}

/** A straight line segment between two concrete endpoints. */
export interface SegmentShape extends ShapeBase {
  readonly kind: 'segment';
  readonly from: Point;
  readonly to: Point;
}

/** A circle given by center + radius. `through` (if present) is the point
 * on the circumference the compass was "drawn from" — used by the animator
 * to start the arc-sweep draw-on at the same point Euclid's compass would. */
export interface CircleShape extends ShapeBase {
  readonly kind: 'circle';
  readonly center: Point;
  readonly radius: number;
  readonly through?: Point;
}

/** An outline polygonal region (e.g. the completed triangle), stroke-only. */
export interface PolygonShape extends ShapeBase {
  readonly kind: 'polygon';
  readonly points: readonly Point[];
}

/** A small arc/wedge marking an angle at a vertex, without an explicit fill radius. */
export interface AngleMarkShape extends ShapeBase {
  readonly kind: 'angleMark';
  readonly vertex: Point;
  readonly from: Point;
  readonly to: Point;
}

export type Shape =
  | PointShape
  | LineShape
  | RayShape
  | SegmentShape
  | CircleShape
  | PolygonShape
  | AngleMarkShape;

export type ShapeKind = Shape['kind'];

/** A resolved scene: every shape added so far, keyed by id, in insertion order. */
export interface Scene {
  readonly order: readonly string[];
  readonly shapes: ReadonlyMap<string, Shape>;
}

/** Thrown by kernel ops / evaluator. Always names the offending step/shape id. */
export class GeometryError extends Error {
  readonly stepId: string;

  constructor(stepId: string, message: string) {
    super(`[${stepId}] ${message}`);
    this.name = 'GeometryError';
    this.stepId = stepId;
  }
}
