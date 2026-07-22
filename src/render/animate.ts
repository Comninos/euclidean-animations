// Hand-rolled requestAnimationFrame tween runner. Zero runtime dependencies.
//
// Design constraints (from the plan):
//  - Every tween must be cancellable.
//  - Every tween must be completable-instantly (jump straight to its end
//    state) — required for step-back/seek correctness and for
//    prefers-reduced-motion.
//  - No global clock: each tween owns its own rAF loop, started fresh per
//    step transition. The timeline (player/timeline.ts) is the only thing
//    that sequences multiple tweens/steps together.

import type { Point, Scene, Shape } from '../kernel/types';
import {
  CONSTRUCTION_DASH,
  CONSTRUCTION_OPACITY,
  POINT_RADIUS,
  STROKE_WIDTH,
  STROKE_VECTOR_EFFECT,
  resolveFillOrStroke,
  roleFillOpacity,
  styleForShape,
} from './style';
import { appendRenderedShape, renderShape, toSvgPoint, type RenderedShape } from './svg';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export type Easing = (t: number) => number;

export const easeLinear: Easing = (t) => t;
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ---------------------------------------------------------------------------
// Tween: a single cancellable, instantly-completable rAF-driven animation.
// ---------------------------------------------------------------------------

export interface TweenHandle {
  /** Cancel the tween immediately, leaving visuals in whatever partial state
   * they were in (caller is responsible for a follow-up static render if a
   * clean state is required — see timeline.ts). */
  cancel(): void;
  /** Jump straight to the end state and resolve the returned promise. */
  finishInstantly(): void;
  /** Resolves when the tween completes (either naturally or via finishInstantly). */
  readonly done: Promise<void>;
}

export interface TweenOptions {
  durationMs: number;
  easing?: Easing;
  onFrame: (t: number) => void;
  onDone?: () => void;
}

/** Whether the user's OS/browser requests reduced motion. Checked live
 * (not cached) so it responds to changes during a session. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Run a tween. If prefers-reduced-motion is set, skips straight to the end
 * state (onFrame(1) called once, onDone fires) with no animation frames.
 */
export function runTween(options: TweenOptions): TweenHandle {
  const { durationMs, easing = easeInOutCubic, onFrame, onDone } = options;

  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  let rafId: number | null = null;
  let watchdogId: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (watchdogId !== null) {
      clearTimeout(watchdogId);
      watchdogId = null;
    }
    onDone?.();
    resolveDone();
  };

  // rAF is suspended in hidden tabs/iframes; without a fallback, a tween
  // started while hidden (or hidden mid-flight) would never resolve and the
  // timeline's step commit would hang until the page became visible again.
  if (prefersReducedMotion() || durationMs <= 0 || document.hidden) {
    onFrame(1);
    finish();
    return {
      cancel: finish,
      finishInstantly: finish,
      done,
    };
  }

  const start = performance.now();

  const tick = (now: number) => {
    if (finished) return;
    const elapsed = now - start;
    const rawT = Math.min(1, elapsed / durationMs);
    onFrame(easing(rawT));
    if (rawT >= 1) {
      finish();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  // Watchdog: if frames stop (tab hidden mid-tween), jump to the end state
  // shortly after the tween should have finished so `done` still resolves.
  watchdogId = setTimeout(() => {
    if (!finished) {
      onFrame(1);
      finish();
    }
  }, durationMs + 250);

  return {
    cancel() {
      if (finished) return;
      finished = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      resolveDone();
    },
    finishInstantly() {
      if (finished) return;
      onFrame(1);
      finish();
    },
    done,
  };
}

// ---------------------------------------------------------------------------
// Group of tweens (one step transition = several shapes animating together).
// ---------------------------------------------------------------------------

export interface TweenGroupHandle {
  cancel(): void;
  finishInstantly(): void;
  readonly done: Promise<void>;
}

/** Run several tweens concurrently as one logical unit; cancel/finishInstantly
 * propagate to all of them. `done` resolves once all have completed. */
export function runTweenGroup(handles: readonly TweenHandle[]): TweenGroupHandle {
  const done = Promise.all(handles.map((h) => h.done)).then(() => undefined);
  return {
    cancel() {
      for (const h of handles) h.cancel();
    },
    finishInstantly() {
      for (const h of handles) h.finishInstantly();
    },
    done,
  };
}

// ---------------------------------------------------------------------------
// Per-shape entrance animations (the "add" verb).
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_MS = 900;
const POINT_FADE_DURATION_MS = 400;
const LABEL_FADE_DURATION_MS = 550;
const RESTYLE_DURATION_MS = 600;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A simple opacity fade-in on the node's inline style (inline style so it
 * layers over any theme CSS). Clears itself once done. */
function fadeInTween(node: SVGElement, durationMs: number): TweenHandle {
  node.style.opacity = '0';
  return runTween({
    durationMs,
    onFrame: (t) => {
      node.style.opacity = String(t);
    },
    onDone: () => {
      node.style.opacity = '';
    },
  });
}

/** The two plane-space endpoints of a straight stroke, in draw order
 * (pen starts at `[0]`, travels to `[1]`). */
function strokeEndpoints(shape: Shape): [Point, Point] {
  switch (shape.kind) {
    case 'segment':
      return [shape.from, shape.to];
    case 'line':
      return [shape.a, shape.b];
    case 'ray':
      return [shape.origin, shape.through];
    default:
      throw new Error(`strokeEndpoints: ${shape.kind} is not a straight stroke`);
  }
}

/**
 * Animate a shape's entrance ("add") into the stage. Appends `rendered.node`
 * (and label, if present) to `container`, then animates draw-on / fade
 * appropriate to the shape kind. Returns a cancellable, instantly-finishable
 * handle whose `finishInstantly` leaves the shape in its correct static
 * appearance (equivalent to `renderShape` output).
 */
export function animateAdd(
  container: SVGElement,
  shape: Shape,
  rendered: RenderedShape
): TweenGroupHandle {
  appendRenderedShape(container, rendered);
  const style = styleForShape(shape);
  const handles: TweenHandle[] = [];

  switch (shape.kind) {
    case 'point': {
      const circle = rendered.node as SVGCircleElement;
      handles.push(fadeInTween(circle, POINT_FADE_DURATION_MS));
      break;
    }
    case 'segment':
    case 'line':
    case 'ray': {
      // Draw the stroke gradually from its start point to its end point by
      // growing the path geometry itself. (A stroke-dashoffset "draw-on" is
      // incompatible with vector-effect: non-scaling-stroke — the browser
      // computes dashes in viewport space and ignores pathLength, so the
      // dash collapses and the line never sweeps.)
      const path = rendered.node as SVGPathElement;
      const [fromPt, toPt] = strokeEndpoints(shape);
      const a = toSvgPoint(fromPt);
      const b = toSvgPoint(toPt);
      const fullD = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
      path.setAttribute('d', `M ${a.x} ${a.y} L ${a.x} ${a.y}`);
      handles.push(
        runTween({
          durationMs: DEFAULT_DURATION_MS,
          onFrame: (t) => {
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t;
            path.setAttribute('d', `M ${a.x} ${a.y} L ${x} ${y}`);
          },
          onDone: () => {
            path.setAttribute('d', fullD);
          },
        })
      );
      break;
    }
    case 'circle': {
      // Arc-sweep starting at the `through` point, matching compass motion.
      // We redraw the circle as a <path> arc that grows from the start point
      // around the centre by a widening swept angle, then swap to a plain
      // <circle> element for a crisp final shape. (Growing the arc geometry
      // rather than animating stroke-dashoffset keeps the sweep working under
      // vector-effect: non-scaling-stroke, which otherwise ignores pathLength
      // and collapses dash-based draw-on.)
      const circleShape = shape;
      const startPoint = circleShape.through ?? {
        x: circleShape.center.x + circleShape.radius,
        y: circleShape.center.y,
      };
      const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const c = toSvgPoint(circleShape.center);
      const s = toSvgPoint(startPoint);
      const r = circleShape.radius;
      // Angle of the start point about the centre (SVG y-down space). The
      // sweep advances in the positive-angle direction (sweep-flag 1), which
      // reads as clockwise on screen — the compass motion.
      const a0 = Math.atan2(s.y - c.y, s.x - c.x);
      arcPath.setAttribute('d', `M ${s.x} ${s.y}`);
      arcPath.setAttribute('fill', 'none');
      arcPath.setAttribute('stroke', style.stroke);
      arcPath.setAttribute('stroke-width', String(style.strokeWidth));
      arcPath.setAttribute('stroke-linecap', style.lineCap);
      arcPath.setAttribute('vector-effect', STROKE_VECTOR_EFFECT);
      if (style.strokeOpacity !== 1) arcPath.setAttribute('stroke-opacity', String(style.strokeOpacity));
      arcPath.setAttribute('data-id', `${shape.id}__sweep`);
      arcPath.setAttribute('data-kind', 'circle');
      arcPath.setAttribute('data-role', shape.role);
      // Inherit the current-step mark so the sweeping compass arc draws in
      // the accent color too, not just the final circle.
      if (rendered.node.hasAttribute('data-current')) arcPath.setAttribute('data-current', '');
      const geometryParent = rendered.node.parentNode;
      geometryParent?.replaceChild(arcPath, rendered.node);

      handles.push(
        runTween({
          durationMs: DEFAULT_DURATION_MS + 150,
          onFrame: (t) => {
            // Cap just short of a full turn: a 2π arc has coincident
            // endpoints and would render as nothing. The crisp <circle>
            // takes over at onDone.
            const theta = Math.min(t, 0.9999) * 2 * Math.PI;
            const end = {
              x: c.x + r * Math.cos(a0 + theta),
              y: c.y + r * Math.sin(a0 + theta),
            };
            const largeArc = theta > Math.PI ? 1 : 0;
            arcPath.setAttribute('d', `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`);
          },
          onDone: () => {
            // Swap back to the crisp <circle> node for final rendering.
            arcPath.parentNode?.replaceChild(rendered.node, arcPath);
          },
        })
      );
      break;
    }
    case 'polygon': {
      const poly = rendered.node as SVGPathElement;
      handles.push(fadeInTween(poly, LABEL_FADE_DURATION_MS));
      break;
    }
    case 'angleMark': {
      const mark = rendered.node as SVGPathElement;
      handles.push(fadeInTween(mark, LABEL_FADE_DURATION_MS));
      break;
    }
    default: {
      const exhaustive: never = shape;
      throw new Error(`animateAdd: unhandled shape kind ${(exhaustive as Shape).kind}`);
    }
  }

  if (rendered.label) {
    handles.push(fadeInTween(rendered.label, LABEL_FADE_DURATION_MS));
  }

  return runTweenGroup(handles);
}

// ---------------------------------------------------------------------------
// Restyle ("set") — animated crossfade between two visual states.
// ---------------------------------------------------------------------------

export function animateRestyle(
  node: SVGElement,
  from: Shape,
  to: Shape,
  label: SVGTextElement | null = null
): TweenGroupHandle {
  const fromStyle = styleForShape(from);
  const toStyle = styleForShape(to);
  const fromFill = roleFillOpacity(from.role);
  const toFill = roleFillOpacity(to.role);
  const isPoint = from.kind === 'point';

  const handle = runTween({
    durationMs: RESTYLE_DURATION_MS,
    onFrame: (t) => {
      const strokeOpacity = lerp(fromStyle.strokeOpacity, toStyle.strokeOpacity, t);
      const strokeWidth = lerp(fromStyle.strokeWidth, toStyle.strokeWidth, t);
      node.setAttribute('stroke', t < 0.5 ? fromStyle.stroke : toStyle.stroke);
      node.setAttribute('stroke-opacity', String(strokeOpacity));
      node.setAttribute('stroke-width', String(strokeWidth));
      // Points carry a solid fill and shapes may carry a label; both fade
      // with the role change (fully out for 'hidden').
      if (isPoint) node.setAttribute('fill-opacity', String(lerp(fromFill, toFill, t)));
      if (label) label.setAttribute('opacity', String(lerp(fromFill, toFill, t)));
      // Dash pattern flips at the midpoint rather than interpolating (dash
      // arrays don't tween meaningfully) — visually reads as part of the fade.
      if (t > 0.5) {
        if (toStyle.strokeDasharray) node.setAttribute('stroke-dasharray', toStyle.strokeDasharray);
        else node.removeAttribute('stroke-dasharray');
      } else {
        if (fromStyle.strokeDasharray) node.setAttribute('stroke-dasharray', fromStyle.strokeDasharray);
        else node.removeAttribute('stroke-dasharray');
      }
    },
    onDone: () => {
      node.setAttribute('stroke', toStyle.stroke);
      node.setAttribute('stroke-opacity', String(toStyle.strokeOpacity));
      node.setAttribute('stroke-width', String(toStyle.strokeWidth));
      if (toStyle.strokeDasharray) node.setAttribute('stroke-dasharray', toStyle.strokeDasharray);
      else node.removeAttribute('stroke-dasharray');
      if (isPoint) node.setAttribute('fill-opacity', String(toFill));
      if (label) label.setAttribute('opacity', String(toFill));
      node.setAttribute('data-role', to.role);
    },
  });

  return runTweenGroup([handle]);
}

// ---------------------------------------------------------------------------
// Static (instant) application, mirroring svg.ts, used by finishInstantly
// paths and by the reduced-motion / seek code paths in timeline.ts.
// ---------------------------------------------------------------------------

/** Re-render a shape's node to its exact static end state, bypassing all
 * animation. Used when a tween is cancelled mid-flight and the timeline
 * needs a guaranteed-clean render (see player/timeline.ts). */
export function applyStaticStyle(node: SVGElement, shape: Shape): void {
  const style = styleForShape(shape);
  node.setAttribute('stroke', style.stroke);
  node.setAttribute('stroke-width', String(style.strokeWidth));
  node.setAttribute('stroke-opacity', String(style.strokeOpacity));
  node.setAttribute('vector-effect', STROKE_VECTOR_EFFECT);
  if (style.strokeDasharray) node.setAttribute('stroke-dasharray', style.strokeDasharray);
  else node.removeAttribute('stroke-dasharray');
  node.removeAttribute('pathLength');
  node.style.strokeDashoffset = '';
  node.style.strokeDasharray = '';
  if (shape.kind === 'point') {
    node.setAttribute('fill', resolveFillOrStroke(shape.color));
    node.setAttribute('fill-opacity', '1');
    node.setAttribute('r', String(POINT_RADIUS));
  } else {
    node.setAttribute('fill', 'none');
  }
  node.setAttribute('data-role', shape.role);
}

// Re-export a couple of style constants some callers (timeline.ts) need
// without importing style.ts directly, keeping animate.ts as the animation
// surface API.
export { CONSTRUCTION_DASH, CONSTRUCTION_OPACITY, STROKE_WIDTH };
export type { Scene };
