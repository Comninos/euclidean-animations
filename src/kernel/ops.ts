// Geometry operations: intersections, midpoint, perpendiculars, extension,
// point-at-distance, angle-between-rays. Pure functions over the plain data
// types in `types.ts`. No DOM, no rendering concerns.
//
// ── Intersection pick-order convention ──────────────────────────────────
// Ops that can return two solutions (circle–circle, line–circle) return
// them as a tuple `[p0, p1]` in a fixed, deterministic order so the JSON
// format can select one with `"pick": 0 | 1` and always get the same point.
//
//   circle–circle: let d = center2 - center1 (the center1→center2 vector).
//     p0 is the intersection point that lies to the LEFT of d (i.e. the
//     point reached by rotating d counter-clockwise into the intersection
//     half-plane); p1 is the mirror point on the right.
//     Concretely: p0 = M + n*h, p1 = M - n*h, where M is the point on the
//     center1→center2 line where the radical axis crosses it, n is d
//     rotated +90° (counter-clockwise) and normalized, and h >= 0.
//
//   line–circle: let d be the line's direction vector (b - a). p0 is the
//     solution reached first when walking along +d from the point on the
//     line nearest the circle's center (i.e. the smaller of the two
//     parameter values t along a + t*d); p1 is the other. This matches
//     "counter-clockwise" in the degenerate sense of "the one you meet
//     first walking forward along the line".
//
// Both conventions are locked in by tests/ops.test.ts.

import { GeometryError, type Point } from './types';

const EPSILON = 1e-9;

export function distance(p: Point, q: Point): number {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

export function midpoint(p: Point, q: Point): Point {
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

export function subtract(p: Point, q: Point): Point {
  return { x: p.x - q.x, y: p.y - q.y };
}

export function add(p: Point, q: Point): Point {
  return { x: p.x + q.x, y: p.y + q.y };
}

export function scale(p: Point, s: number): Point {
  return { x: p.x * s, y: p.y * s };
}

export function length(v: Point): number {
  return Math.hypot(v.x, v.y);
}

export function normalize(v: Point, stepId: string): Point {
  const len = length(v);
  if (len < EPSILON) {
    throw new GeometryError(stepId, 'cannot normalize a zero-length vector (two points coincide)');
  }
  return { x: v.x / len, y: v.y / len };
}

/** Rotate a vector 90 degrees counter-clockwise (math convention, y-up). */
export function rotate90ccw(v: Point): Point {
  return { x: -v.y, y: v.x };
}

export function dot(p: Point, q: Point): number {
  return p.x * q.x + p.y * q.y;
}

/** Perpendicular through `point`, given as two points spanning the perpendicular
 * line, using `along` (a segment/line direction) as the line to be perpendicular to. */
export function perpendicularThrough(point: Point, along: Point, stepId: string): { a: Point; b: Point } {
  const dir = normalize(along, stepId);
  const perp = rotate90ccw(dir);
  return { a: subtract(point, perp), b: add(point, perp) };
}

/** The foot of the perpendicular dropped from `p` onto the infinite line through `a`,`b`. */
export function footOfPerpendicular(p: Point, a: Point, b: Point, stepId: string): Point {
  const dir = subtract(b, a);
  const len2 = dot(dir, dir);
  if (len2 < EPSILON) {
    throw new GeometryError(stepId, 'cannot drop a perpendicular onto a degenerate line (a and b coincide)');
  }
  const t = dot(subtract(p, a), dir) / len2;
  return add(a, scale(dir, t));
}

/** Extend the segment/ray from `a` through `b`, returning the point at the
 * given absolute distance from `a` (may be less than, equal to, or greater
 * than |ab| — negative distance is not supported here, use pointAtDistance
 * with a direction reversal if needed). */
export function extend(a: Point, b: Point, distanceFromA: number, stepId: string): Point {
  const dir = normalize(subtract(b, a), stepId);
  return add(a, scale(dir, distanceFromA));
}

/** A point at the given distance from `origin`, in the direction of `through`. */
export function pointAtDistance(origin: Point, through: Point, dist: number, stepId: string): Point {
  const dir = normalize(subtract(through, origin), stepId);
  return add(origin, scale(dir, dist));
}

/** Unsigned angle between the rays vertex->p and vertex->q, in radians [0, PI]. */
export function angleBetween(vertex: Point, p: Point, q: Point, stepId: string): number {
  const u = normalize(subtract(p, vertex), stepId);
  const v = normalize(subtract(q, vertex), stepId);
  const c = Math.min(1, Math.max(-1, dot(u, v)));
  return Math.acos(c);
}

export interface LineDef {
  a: Point;
  b: Point;
}

export interface CircleDef {
  center: Point;
  radius: number;
}

/**
 * Intersection of two infinite lines (each given by two points).
 * Throws if the lines are parallel (including coincident) — there is no
 * well-defined single/double intersection to pick from.
 */
export function intersectLineLine(l1: LineDef, l2: LineDef, stepId: string): Point {
  const d1 = subtract(l1.b, l1.a);
  const d2 = subtract(l2.b, l2.a);
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < EPSILON) {
    throw new GeometryError(stepId, 'lines are parallel (or coincident) — no unique intersection');
  }
  const diff = subtract(l2.a, l1.a);
  const t = (diff.x * d2.y - diff.y * d2.x) / denom;
  return add(l1.a, scale(d1, t));
}

/**
 * Intersection(s) of an infinite line with a circle. Returns a tuple of the
 * two solutions in the documented pick order (see file header). Throws with
 * a step-named error for the tangent (single solution) and no-intersection
 * cases, since the format only ever needs a genuine two-point pick here;
 * callers that need the tangent point specially should use a dedicated op.
 */
export function intersectLineCircle(line: LineDef, circle: CircleDef, stepId: string): [Point, Point] {
  const dir = subtract(line.b, line.a);
  const dirLen = length(dir);
  if (dirLen < EPSILON) {
    throw new GeometryError(stepId, 'cannot intersect a degenerate line (a and b coincide) with a circle');
  }
  const u = scale(dir, 1 / dirLen);
  // Solve |a + t*u - center|^2 = r^2
  const toCenter = subtract(line.a, circle.center);
  const b = dot(u, toCenter) * 2;
  const c = dot(toCenter, toCenter) - circle.radius * circle.radius;
  const disc = b * b - 4 * c;
  if (disc < -EPSILON) {
    throw new GeometryError(stepId, 'line and circle do not intersect');
  }
  if (disc < EPSILON) {
    throw new GeometryError(
      stepId,
      'line is tangent to circle (single intersection point) — this op requires two distinct solutions'
    );
  }
  const sqrtDisc = Math.sqrt(disc);
  const t0 = (-b - sqrtDisc) / 2;
  const t1 = (-b + sqrtDisc) / 2;
  // t0 < t1 always (sqrtDisc > 0), so p0 is met first walking along +dir from line.a.
  const p0 = add(line.a, scale(u, t0));
  const p1 = add(line.a, scale(u, t1));
  return [p0, p1];
}

/**
 * Intersection(s) of two circles. Returns a tuple of the two solutions in
 * the documented pick order (pick 0 = left of the center1->center2 vector,
 * i.e. counter-clockwise). Throws with a step-named error for tangency
 * (internal or external — single solution) and for separate/contained
 * (no-intersection) circles.
 */
export function intersectCircleCircle(c1: CircleDef, c2: CircleDef, stepId: string): [Point, Point] {
  const d = subtract(c2.center, c1.center);
  const dist = length(d);
  if (dist < EPSILON) {
    throw new GeometryError(stepId, 'circles are concentric — no well-defined intersection');
  }
  const r1 = c1.radius;
  const r2 = c2.radius;
  if (dist > r1 + r2 + EPSILON) {
    throw new GeometryError(stepId, 'circles are too far apart to intersect (separate circles)');
  }
  if (dist < Math.abs(r1 - r2) - EPSILON) {
    throw new GeometryError(stepId, 'one circle lies entirely inside the other (no intersection)');
  }
  const tangentExternal = Math.abs(dist - (r1 + r2)) < EPSILON;
  const tangentInternal = Math.abs(dist - Math.abs(r1 - r2)) < EPSILON;
  if (tangentExternal || tangentInternal) {
    throw new GeometryError(stepId, 'circles are tangent (single intersection point) — this op requires two distinct solutions');
  }

  // Standard circle-circle intersection via the radical line.
  const a = (dist * dist + r1 * r1 - r2 * r2) / (2 * dist);
  const hSq = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(0, hSq));
  const dirUnit = scale(d, 1 / dist);
  const m = add(c1.center, scale(dirUnit, a));
  const n = rotate90ccw(dirUnit); // +90 deg rotation of center1->center2 = "left" direction
  const p0 = add(m, scale(n, h)); // left of d => pick 0
  const p1 = add(m, scale(n, -h)); // right of d => pick 1
  return [p0, p1];
}
