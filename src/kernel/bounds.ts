// Scene bounding-box computation, used to auto-frame a proposition: the
// initial viewBox is derived from the *final* constructed scene so nothing
// drawn at any step ever falls outside the frame. Pure math, no DOM.
//
// Coordinates are plane-space (y-up), same as kernel/types.ts; the result
// is a `ViewBox` in the same convention the renderer's y-flip expects.

import type { Scene, Shape, Point } from './types';
import type { ViewBox } from '../format/schema';

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function include(b: Bounds, p: Point, margin = 0): void {
  b.minX = Math.min(b.minX, p.x - margin);
  b.minY = Math.min(b.minY, p.y - margin);
  b.maxX = Math.max(b.maxX, p.x + margin);
  b.maxY = Math.max(b.maxY, p.y + margin);
}

function includeShape(b: Bounds, shape: Shape): void {
  switch (shape.kind) {
    case 'point':
      include(b, shape.at);
      break;
    case 'segment':
      include(b, shape.from);
      include(b, shape.to);
      break;
    case 'line':
      include(b, shape.a);
      include(b, shape.b);
      break;
    case 'ray':
      include(b, shape.origin);
      include(b, shape.through);
      break;
    case 'circle':
      include(b, shape.center, shape.radius);
      break;
    case 'polygon':
      for (const p of shape.points) include(b, p);
      break;
    case 'angleMark':
      include(b, shape.vertex);
      break;
    default: {
      const exhaustive: never = shape;
      throw new Error(`includeShape: unhandled shape kind ${(exhaustive as Shape).kind}`);
    }
  }
}

/** Minimum padding in plane units — sized to fit a label (font 0.16 +
 * offset 0.13 = 0.29) drawn just outside the outermost geometry, trimmed as
 * tight as that still allows while keeping the drawing as large as
 * possible. */
const MIN_PADDING = 0.28;
/** Padding as a fraction of the scene's larger dimension. */
const PADDING_RATIO = 0.04;

/**
 * Compute a view box that frames every shape in `scene` with comfortable
 * padding. Intended to be called with the final step's scene so the frame
 * holds for the whole construction. Returns a 1x1 box around the origin
 * for an empty scene (degenerate but renderable).
 */
export function computeViewBox(scene: Scene): ViewBox {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const id of scene.order) {
    const shape = scene.shapes.get(id);
    if (shape) includeShape(b, shape);
  }

  if (!Number.isFinite(b.minX)) {
    return { x: -0.5, y: -0.5, width: 1, height: 1 };
  }

  const width = Math.max(b.maxX - b.minX, 1e-6);
  const height = Math.max(b.maxY - b.minY, 1e-6);
  const pad = Math.max(MIN_PADDING, PADDING_RATIO * Math.max(width, height));

  return {
    x: b.minX - pad,
    y: b.minY - pad,
    width: width + 2 * pad,
    height: height + 2 * pad,
  };
}
