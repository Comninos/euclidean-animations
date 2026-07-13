// The DAG evaluator: folds a proposition's `given` points + step list into
// concrete resolved shapes. Pure, synchronous, no DOM. Errors always name
// the offending step id (via GeometryError) so the player can surface them.

import {
  distance,
  intersectCircleCircle,
  intersectLineCircle,
  intersectLineLine,
  midpoint,
  extend,
  pointAtDistance,
  footOfPerpendicular,
} from './ops';
import { GeometryError, type ColorName, type Point, type Scene, type Shape, type ShapeRole } from './types';
import type { AddOp, ProposedStep, Proposition, SetOp } from '../format/schema';

interface EvalState {
  /** Concrete point coordinates for every id that resolves to a point
   * (given points, `point` ops, and `intersect` ops). */
  points: Map<string, Point>;
  /** All resolved shapes so far, keyed by id, in insertion order. */
  shapes: Map<string, Shape>;
  order: string[];
}

function requirePoint(state: EvalState, id: string, stepId: string): Point {
  const p = state.points.get(id);
  if (!p) {
    throw new GeometryError(stepId, `reference "${id}" is not a known point (check spelling / step order)`);
  }
  return p;
}

function requireShape(state: EvalState, id: string, stepId: string): Shape {
  const s = state.shapes.get(id);
  if (!s) {
    throw new GeometryError(stepId, `reference "${id}" is not a known shape (check spelling / step order)`);
  }
  return s;
}

function resolveColor(color: ColorName | undefined, fallback: ColorName): ColorName {
  return color ?? fallback;
}

function putShape(state: EvalState, id: string, shape: Shape): void {
  if (!state.shapes.has(id)) {
    state.order.push(id);
  }
  state.shapes.set(id, shape);
}

function applyAdd(state: EvalState, op: AddOp, stepId: string): void {
  switch (op.op) {
    case 'point': {
      const at = 'at' in op && op.at ? { x: op.at[0], y: op.at[1] } : state.points.get(op.id);
      if (!at) {
        throw new GeometryError(stepId, `point "${op.id}" has no coordinates and is not a pre-given point`);
      }
      state.points.set(op.id, at);
      putShape(state, op.id, {
        kind: 'point',
        id: op.id,
        at,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'segment': {
      const from = requirePoint(state, op.from, stepId);
      const to = requirePoint(state, op.to, stepId);
      putShape(state, op.id, {
        kind: 'segment',
        id: op.id,
        from,
        to,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'line': {
      const a = requirePoint(state, op.a, stepId);
      const b = requirePoint(state, op.b, stepId);
      putShape(state, op.id, {
        kind: 'line',
        id: op.id,
        a,
        b,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'ray': {
      const origin = requirePoint(state, op.origin, stepId);
      const through = requirePoint(state, op.through, stepId);
      putShape(state, op.id, {
        kind: 'ray',
        id: op.id,
        origin,
        through,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'circle': {
      const center = requirePoint(state, op.center, stepId);
      const through = requirePoint(state, op.through, stepId);
      const radius = distance(center, through);
      putShape(state, op.id, {
        kind: 'circle',
        id: op.id,
        center,
        radius,
        through,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'intersect': {
      const [refA, refB] = op.of;
      const shapeA = requireShape(state, refA, stepId);
      const shapeB = requireShape(state, refB, stepId);
      const pt = resolveIntersection(shapeA, shapeB, op.pick, stepId);
      state.points.set(op.id, pt);
      putShape(state, op.id, {
        kind: 'point',
        id: op.id,
        at: pt,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'midpoint': {
      const a = requirePoint(state, op.a, stepId);
      const b = requirePoint(state, op.b, stepId);
      const pt = midpoint(a, b);
      state.points.set(op.id, pt);
      putShape(state, op.id, {
        kind: 'point',
        id: op.id,
        at: pt,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'extend': {
      const a = requirePoint(state, op.from, stepId);
      const b = requirePoint(state, op.through, stepId);
      const pt = extend(a, b, op.distance, stepId);
      state.points.set(op.id, pt);
      putShape(state, op.id, {
        kind: 'point',
        id: op.id,
        at: pt,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'pointAtDistance': {
      const origin = requirePoint(state, op.origin, stepId);
      const through = requirePoint(state, op.through, stepId);
      const pt = pointAtDistance(origin, through, op.distance, stepId);
      state.points.set(op.id, pt);
      putShape(state, op.id, {
        kind: 'point',
        id: op.id,
        at: pt,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'footOfPerpendicular': {
      const p = requirePoint(state, op.from, stepId);
      const a = requirePoint(state, op.lineA, stepId);
      const b = requirePoint(state, op.lineB, stepId);
      const pt = footOfPerpendicular(p, a, b, stepId);
      state.points.set(op.id, pt);
      putShape(state, op.id, {
        kind: 'point',
        id: op.id,
        at: pt,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'polygon': {
      const pts = op.of.map((ref) => requirePoint(state, ref, stepId));
      putShape(state, op.id, {
        kind: 'polygon',
        id: op.id,
        points: pts,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    case 'angleMark': {
      const vertex = requirePoint(state, op.vertex, stepId);
      const from = requirePoint(state, op.from, stepId);
      const to = requirePoint(state, op.to, stepId);
      putShape(state, op.id, {
        kind: 'angleMark',
        id: op.id,
        vertex,
        from,
        to,
        color: resolveColor(op.color, 'black'),
        role: 'normal',
        ...(op.label !== undefined ? { label: op.label } : {}),
      });
      break;
    }
    default: {
      const exhaustive: never = op;
      throw new GeometryError(stepId, `unknown op "${(exhaustive as { op: string }).op}"`);
    }
  }
}

function resolveIntersection(
  shapeA: Shape,
  shapeB: Shape,
  pick: 0 | 1,
  stepId: string
): Point {
  const kindPair = [shapeA.kind, shapeB.kind].sort().join('-');

  if (shapeA.kind === 'circle' && shapeB.kind === 'circle') {
    const pts = intersectCircleCircle(
      { center: shapeA.center, radius: shapeA.radius },
      { center: shapeB.center, radius: shapeB.radius },
      stepId
    );
    return pts[pick];
  }

  const lineLike = (s: Shape): { a: Point; b: Point } | null => {
    switch (s.kind) {
      case 'line':
        return { a: s.a, b: s.b };
      case 'segment':
        return { a: s.from, b: s.to };
      case 'ray':
        return { a: s.origin, b: s.through };
      default:
        return null;
    }
  };

  const l1 = lineLike(shapeA);
  const l2 = lineLike(shapeB);

  if (l1 && l2) {
    // Straight-straight intersection has a single solution; pick is ignored
    // but must be 0 for clarity/consistency in the format.
    if (pick !== 0) {
      throw new GeometryError(stepId, `line-line intersection has only one solution; "pick" must be 0 (got ${pick})`);
    }
    return intersectLineLine(l1, l2, stepId);
  }

  const circleShape = shapeA.kind === 'circle' ? shapeA : shapeB.kind === 'circle' ? shapeB : null;
  const lineShape = l1 ?? l2;

  if (circleShape && lineShape) {
    const pts = intersectLineCircle(lineShape, { center: circleShape.center, radius: circleShape.radius }, stepId);
    return pts[pick];
  }

  throw new GeometryError(
    stepId,
    `cannot intersect shapes of kind "${shapeA.kind}" and "${shapeB.kind}" (pair: ${kindPair})`
  );
}

function applySet(state: EvalState, op: SetOp, stepId: string): void {
  for (const targetId of op.targets) {
    const shape = requireShape(state, targetId, stepId);
    const nextRole: ShapeRole = op.role ?? shape.role;
    const nextColor: ColorName = op.color ?? shape.color;
    state.shapes.set(targetId, { ...shape, role: nextRole, color: nextColor } as Shape);
  }
}

/**
 * Fold `given` points and the first `stepCount` steps of `steps` into a
 * resolved Scene. `stepCount` may be 0..steps.length inclusive; 0 means
 * only the given points exist (no shapes yet, aside from implicit points
 * which are not auto-added as visible shapes unless a step adds them).
 */
export function stateAt(prop: Proposition, stepCount: number): Scene {
  const state: EvalState = { points: new Map(), shapes: new Map(), order: [] };

  for (const [id, coords] of Object.entries(prop.given)) {
    state.points.set(id, { x: coords[0], y: coords[1] });
  }

  const clamped = Math.max(0, Math.min(stepCount, prop.steps.length));

  for (let i = 0; i < clamped; i++) {
    const step = prop.steps[i];
    if (!step) continue;
    applyStep(state, step, i);
  }

  return { order: [...state.order], shapes: new Map(state.shapes) };
}

/** Apply a single step (by index, used to build a step id for errors) to the state. */
function applyStep(state: EvalState, step: ProposedStep, index: number): void {
  const stepId = step.id ?? `step[${index}]`;
  for (const op of step.add ?? []) {
    applyAdd(state, op, stepId);
  }
  for (const op of step.set ?? []) {
    applySet(state, op, stepId);
  }
  // `highlight` is a purely presentational/animation concern (transient
  // pulse) and does not change resolved geometry, so it's a no-op here.
}

/** Evaluate every step and return the full list of intermediate scenes,
 * `scenes[k] === stateAt(prop, k)`, computed in one incremental pass. */
export function evaluateAll(prop: Proposition): Scene[] {
  const scenes: Scene[] = [];
  for (let k = 0; k <= prop.steps.length; k++) {
    scenes.push(stateAt(prop, k));
  }
  return scenes;
}
