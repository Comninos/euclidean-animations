// Exact stroke-coincidence detection. When a later visible shape fully
// covers an earlier one's stroked path (same segment endpoints, same
// circle, polygon edges that include a segment, …), the earlier stroke is
// suppressed so stacked anti-aliased edges don't fringe through a
// different-colored stroke on top (e.g. accent red over ink).
//
// Comparison is exact coordinate equality: shapes built from the same
// point ids share identical Point values from the evaluator.

import type { Point, Scene, Shape } from '../kernel/types';

function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

/** Undirected edge key — AB and BA are the same stroke. */
function edgeKey(a: Point, b: Point): string {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Edge primitives as rendered. Line/ray are stroked only between their two
 * defining points (see svg.ts), so they participate as a single edge — not
 * as infinite lines.
 */
function edgesOf(shape: Shape): string[] | null {
  switch (shape.kind) {
    case 'segment':
      return [edgeKey(shape.from, shape.to)];
    case 'line':
      return [edgeKey(shape.a, shape.b)];
    case 'ray':
      return [edgeKey(shape.origin, shape.through)];
    case 'polygon': {
      const pts = shape.points;
      if (pts.length < 2) return [];
      const edges: string[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (!a || !b) continue;
        edges.push(edgeKey(a, b));
      }
      return edges;
    }
    default:
      return null;
  }
}

function isSuppressibleStroke(shape: Shape): boolean {
  return (
    shape.kind === 'segment' ||
    shape.kind === 'line' ||
    shape.kind === 'ray' ||
    shape.kind === 'circle' ||
    shape.kind === 'polygon'
  );
}

/** True when every stroked primitive of `lower` is present on `upper`. */
export function strokeCovers(upper: Shape, lower: Shape): boolean {
  if (lower.kind === 'circle') {
    return (
      upper.kind === 'circle' &&
      samePoint(upper.center, lower.center) &&
      upper.radius === lower.radius
    );
  }

  const lowerEdges = edgesOf(lower);
  if (!lowerEdges || lowerEdges.length === 0) return false;
  const upperEdges = edgesOf(upper);
  if (!upperEdges) return false;
  const upperSet = new Set(upperEdges);
  return lowerEdges.every((e) => upperSet.has(e));
}

/**
 * Ids of visible strokes that should not paint because a later visible
 * shape in `scene.order` fully covers their geometry.
 */
export function suppressedStrokeIds(scene: Scene): ReadonlySet<string> {
  const visible: Shape[] = [];
  for (const id of scene.order) {
    const shape = scene.shapes.get(id);
    if (!shape || shape.role === 'hidden' || !isSuppressibleStroke(shape)) continue;
    visible.push(shape);
  }

  const suppressed = new Set<string>();
  for (let i = 0; i < visible.length; i++) {
    const lower = visible[i];
    if (!lower) continue;
    for (let j = i + 1; j < visible.length; j++) {
      const upper = visible[j];
      if (!upper) continue;
      if (strokeCovers(upper, lower)) {
        suppressed.add(lower.id);
        break;
      }
    }
  }
  return suppressed;
}
