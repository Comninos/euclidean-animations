// Label placement: pick a readable position for a shape's letter relative
// to its anchor, using incident geometry when a scene is available.
//
// Priority: explicit `labelOffset` > `labelSide` > angular-gap heuristic
// (largest free sector around a point, preferring gaps outside angle marks)
// > default northeast offset.

import type { LabelSide, Point, Scene, Shape } from '../kernel/types';
import { LABEL_OFFSET } from './style';

const EPS = 1e-9;
/** Angles within this many radians are treated as the same incident edge. */
const ANGLE_MERGE = 1e-3;

const SIDE_DIRS: Record<LabelSide, Point> = {
  N: { x: 0, y: 1 },
  NE: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  E: { x: 1, y: 0 },
  SE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  S: { x: 0, y: -1 },
  SW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  W: { x: -1, y: 0 },
  NW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
};

/** Default placement when nothing better is known: northeast of the anchor. */
const DEFAULT_DIR = SIDE_DIRS.NE;

export interface LabelPlacement {
  /** Plane-space point (y-up) at which the glyph center should sit. */
  readonly position: Point;
}

function near(a: Point, b: Point): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
}

function unit(dx: number, dy: number): Point | null {
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  return { x: dx / len, y: dy / len };
}

function distPointToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function pushAngle(angles: number[], u: Point | null): void {
  if (!u) return;
  angles.push(Math.atan2(u.y, u.x));
}

/** Normalize Δ into (-π, π]. */
function normalizeDelta(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** True if `angle` lies on the minor arc from `a0` to `a1` (inclusive). */
function angleInMinorArc(angle: number, a0: number, a1: number): boolean {
  const span = normalizeDelta(a1 - a0);
  const t = normalizeDelta(angle - a0);
  if (span >= 0) return t >= -ANGLE_MERGE && t <= span + ANGLE_MERGE;
  return t <= ANGLE_MERGE && t >= span - ANGLE_MERGE;
}

interface AngleWedge {
  readonly a0: number;
  readonly a1: number;
  readonly bisector: number;
}

function wedgeFromDirs(from: Point, vertex: Point, to: Point): AngleWedge | null {
  const u0 = unit(from.x - vertex.x, from.y - vertex.y);
  const u1 = unit(to.x - vertex.x, to.y - vertex.y);
  if (!u0 || !u1) return null;
  const a0 = Math.atan2(u0.y, u0.x);
  const a1 = Math.atan2(u1.y, u1.x);
  const span = normalizeDelta(a1 - a0);
  const bisector = a0 + span / 2;
  return { a0, a1, bisector };
}

function uniqueSortedAngles(raw: number[]): number[] {
  if (raw.length === 0) return [];
  const sorted = [...raw].sort((a, b) => a - b);
  const out: number[] = [];
  for (const a of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || Math.abs(normalizeDelta(a - last)) > ANGLE_MERGE) {
      out.push(a);
    }
  }
  // Merge first/last if they wrap around the circle within ANGLE_MERGE.
  if (out.length >= 2) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.abs(normalizeDelta(first + 2 * Math.PI - last)) <= ANGLE_MERGE) {
      out.pop();
    }
  }
  return out;
}

/** Collect unit directions of strokes that meet `anchor`. */
function collectIncidentAngles(anchor: Point, scene: Scene): number[] {
  const angles: number[] = [];

  for (const shape of scene.shapes.values()) {
    if (shape.role === 'hidden') continue;

    switch (shape.kind) {
      case 'segment': {
        if (near(shape.from, anchor)) {
          pushAngle(angles, unit(shape.to.x - shape.from.x, shape.to.y - shape.from.y));
        }
        if (near(shape.to, anchor)) {
          pushAngle(angles, unit(shape.from.x - shape.to.x, shape.from.y - shape.to.y));
        }
        break;
      }
      case 'line': {
        if (distPointToLine(anchor, shape.a, shape.b) < 1e-6) {
          const u = unit(shape.b.x - shape.a.x, shape.b.y - shape.a.y);
          if (u) {
            pushAngle(angles, u);
            pushAngle(angles, { x: -u.x, y: -u.y });
          }
        }
        break;
      }
      case 'ray': {
        if (near(shape.origin, anchor)) {
          pushAngle(angles, unit(shape.through.x - shape.origin.x, shape.through.y - shape.origin.y));
        } else if (distPointToLine(anchor, shape.origin, shape.through) < 1e-6) {
          // Anchor lies on the ray's supporting line past the origin: block both ways.
          const along = unit(shape.through.x - shape.origin.x, shape.through.y - shape.origin.y);
          if (along) {
            const t =
              ((anchor.x - shape.origin.x) * along.x + (anchor.y - shape.origin.y) * along.y);
            if (t >= -1e-6) {
              pushAngle(angles, along);
              pushAngle(angles, { x: -along.x, y: -along.y });
            }
          }
        }
        break;
      }
      case 'polygon': {
        const pts = shape.points;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const p = pts[i]!;
          if (!near(p, anchor)) continue;
          const prev = pts[(i - 1 + n) % n]!;
          const next = pts[(i + 1) % n]!;
          pushAngle(angles, unit(prev.x - p.x, prev.y - p.y));
          pushAngle(angles, unit(next.x - p.x, next.y - p.y));
        }
        break;
      }
      default:
        break;
    }
  }

  return uniqueSortedAngles(angles);
}

function collectAngleWedges(anchor: Point, scene: Scene): AngleWedge[] {
  const wedges: AngleWedge[] = [];
  for (const shape of scene.shapes.values()) {
    if (shape.role === 'hidden') continue;
    if (shape.kind !== 'angleMark') continue;
    if (!near(shape.vertex, anchor)) continue;
    const w = wedgeFromDirs(shape.from, shape.vertex, shape.to);
    if (w) wedges.push(w);
  }
  return wedges;
}

function dirFromAngle(theta: number): Point {
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

function offsetAlong(anchor: Point, dir: Point, distance: number = LABEL_OFFSET): Point {
  return { x: anchor.x + dir.x * distance, y: anchor.y + dir.y * distance };
}

/**
 * Pick the mid-angle of the largest free sector around `anchor`, preferring
 * sectors whose midpoint falls outside any angle-mark wedge at the vertex.
 */
function angularGapDirection(anchor: Point, scene: Scene): Point {
  const angles = collectIncidentAngles(anchor, scene);
  const wedges = collectAngleWedges(anchor, scene);

  if (angles.length === 0) {
    if (wedges.length > 0) {
      // No edges yet — sit opposite the first mark's bisector (exterior).
      return dirFromAngle(wedges[0]!.bisector + Math.PI);
    }
    return DEFAULT_DIR;
  }

  type Candidate = { mid: number; size: number; insideMark: boolean };
  const candidates: Candidate[] = [];

  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!;
    const b = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
    const size = b - a;
    const mid = a + size / 2;
    const midNorm = normalizeDelta(mid);
    const insideMark = wedges.some((w) => angleInMinorArc(midNorm, w.a0, w.a1));
    candidates.push({ mid: midNorm, size, insideMark });
  }

  candidates.sort((c, d) => {
    if (c.insideMark !== d.insideMark) return c.insideMark ? 1 : -1;
    return d.size - c.size;
  });

  const best = candidates[0];
  if (!best) return DEFAULT_DIR;
  return dirFromAngle(best.mid);
}

/** Anchor used when the shape itself is labeled (same rules as the old renderer). */
export function labelAnchor(shape: Shape): Point {
  switch (shape.kind) {
    case 'point':
      return shape.at;
    case 'segment':
      return { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 };
    case 'line':
      return { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 };
    case 'ray':
      return shape.through;
    case 'circle':
      return { x: shape.center.x, y: shape.center.y + shape.radius };
    case 'polygon': {
      const n = shape.points.length || 1;
      const sum = shape.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      return { x: sum.x / n, y: sum.y / n };
    }
    case 'angleMark':
      return shape.vertex;
    default: {
      const _exhaustive: never = shape;
      return _exhaustive;
    }
  }
}

/**
 * Compute where a shape's label glyph center should sit in plane space.
 * When `scene` is provided, point labels avoid incident strokes and angle marks.
 */
export function placeLabel(shape: Shape, scene?: Scene): LabelPlacement {
  const anchor = labelAnchor(shape);

  if (shape.labelOffset) {
    return {
      position: { x: anchor.x + shape.labelOffset.x, y: anchor.y + shape.labelOffset.y },
    };
  }

  if (shape.labelSide) {
    return { position: offsetAlong(anchor, SIDE_DIRS[shape.labelSide]) };
  }

  if (scene && shape.kind === 'point') {
    return { position: offsetAlong(anchor, angularGapDirection(anchor, scene)) };
  }

  return { position: offsetAlong(anchor, DEFAULT_DIR) };
}
