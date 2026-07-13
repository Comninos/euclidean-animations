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

import type { Scene, Shape } from '../kernel/types';
import {
  CONSTRUCTION_DASH,
  CONSTRUCTION_OPACITY,
  FILL_OPACITY,
  POINT_RADIUS,
  STROKE_WIDTH,
  resolveFillOrStroke,
  styleForShape,
} from './style';
import { renderShape, toSvgPoint, type RenderedShape } from './svg';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

export type Easing = (t: number) => number;

export const easeLinear: Easing = (t) => t;
export const easeInOutCubic: Easing = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack: Easing = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

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

const DEFAULT_DURATION_MS = 650;
const POINT_POP_DURATION_MS = 320;
const LABEL_FADE_DURATION_MS = 420;
const FILL_FADE_DURATION_MS = 500;
const HIGHLIGHT_DURATION_MS = 700;
const RESTYLE_DURATION_MS = 450;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Compute the SVG path/stroke length so stroke-dasharray draw-on can be
 * normalized to [0,1] via pathLength="1". */
function setupDrawOn(node: SVGGeometryElement): void {
  node.setAttribute('pathLength', '1');
  node.style.strokeDasharray = '1';
  node.style.strokeDashoffset = '1';
}

/**
 * Animate a shape's entrance ("add") into the stage. Appends `rendered.node`
 * (and label, if present) to `container`, then animates draw-on / pop-in /
 * fade appropriate to the shape kind. Returns a cancellable,
 * instantly-finishable handle whose `finishInstantly` leaves the shape in
 * its correct static appearance (equivalent to `renderShape` output).
 */
export function animateAdd(
  container: SVGElement,
  shape: Shape,
  rendered: RenderedShape
): TweenGroupHandle {
  container.appendChild(rendered.node);
  const style = styleForShape(shape);
  const handles: TweenHandle[] = [];

  switch (shape.kind) {
    case 'point': {
      const circle = rendered.node as SVGCircleElement;
      circle.setAttribute('r', '0');
      handles.push(
        runTween({
          durationMs: POINT_POP_DURATION_MS,
          easing: easeOutBack,
          onFrame: (t) => {
            circle.setAttribute('r', String(Math.max(0, POINT_RADIUS * t)));
          },
        })
      );
      break;
    }
    case 'segment':
    case 'line':
    case 'ray': {
      const path = rendered.node as unknown as SVGGeometryElement;
      setupDrawOn(path);
      handles.push(
        runTween({
          durationMs: DEFAULT_DURATION_MS,
          onFrame: (t) => {
            path.style.strokeDashoffset = String(1 - t);
          },
          onDone: () => {
            path.style.strokeDasharray = style.strokeDasharray ?? '';
            path.style.strokeDashoffset = '';
            path.removeAttribute('pathLength');
          },
        })
      );
      break;
    }
    case 'circle': {
      // Arc-sweep starting at the `through` point, matching compass motion.
      // We redraw the circle as a <path> arc from `through` around back to
      // itself, using stroke-dashoffset draw-on (pathLength normalized),
      // then swap to a plain <circle> element for a crisp final shape.
      const circleShape = shape;
      const startPoint = circleShape.through ?? {
        x: circleShape.center.x + circleShape.radius,
        y: circleShape.center.y,
      };
      const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const c = toSvgPoint(circleShape.center);
      const s = toSvgPoint(startPoint);
      const r = circleShape.radius;
      // Full circle via two 180-degree arcs starting and ending at s, sweep
      // flag chosen for a clockwise sweep (matches compass motion visually).
      const mid = { x: c.x - (s.x - c.x), y: c.y - (s.y - c.y) };
      const d = `M ${s.x} ${s.y} A ${r} ${r} 0 1 1 ${mid.x} ${mid.y} A ${r} ${r} 0 1 1 ${s.x} ${s.y}`;
      arcPath.setAttribute('d', d);
      arcPath.setAttribute('fill', 'none');
      arcPath.setAttribute('stroke', style.stroke);
      arcPath.setAttribute('stroke-width', String(style.strokeWidth));
      arcPath.setAttribute('stroke-linecap', style.lineCap);
      if (style.strokeOpacity !== 1) arcPath.setAttribute('stroke-opacity', String(style.strokeOpacity));
      arcPath.setAttribute('data-id', `${shape.id}__sweep`);
      setupDrawOn(arcPath);
      container.replaceChild(arcPath, rendered.node);

      handles.push(
        runTween({
          durationMs: DEFAULT_DURATION_MS + 150,
          onFrame: (t) => {
            arcPath.style.strokeDashoffset = String(1 - t);
          },
          onDone: () => {
            // Swap back to the crisp <circle> node for final rendering.
            container.replaceChild(rendered.node, arcPath);
          },
        })
      );
      break;
    }
    case 'polygon': {
      const poly = rendered.node as SVGPathElement;
      const targetFillOpacity = style.fill ? style.fillOpacity : 0;
      poly.setAttribute('fill-opacity', '0');
      poly.setAttribute('stroke-opacity', '0');
      handles.push(
        runTween({
          durationMs: FILL_FADE_DURATION_MS,
          onFrame: (t) => {
            poly.setAttribute('fill-opacity', String(lerp(0, targetFillOpacity, t)));
            poly.setAttribute('stroke-opacity', String(lerp(0, style.strokeOpacity, t)));
          },
        })
      );
      break;
    }
    case 'sector': {
      const sector = rendered.node as SVGPathElement;
      const targetFillOpacity = style.fill ? style.fillOpacity : 0;
      sector.setAttribute('fill-opacity', '0');
      handles.push(
        runTween({
          durationMs: FILL_FADE_DURATION_MS,
          onFrame: (t) => {
            sector.setAttribute('fill-opacity', String(lerp(0, targetFillOpacity, t)));
          },
        })
      );
      break;
    }
    case 'angleMark': {
      const mark = rendered.node as SVGPathElement;
      mark.setAttribute('stroke-opacity', '0');
      handles.push(
        runTween({
          durationMs: LABEL_FADE_DURATION_MS,
          onFrame: (t) => {
            mark.setAttribute('stroke-opacity', String(lerp(0, style.strokeOpacity, t)));
          },
        })
      );
      break;
    }
    default: {
      const exhaustive: never = shape;
      throw new Error(`animateAdd: unhandled shape kind ${(exhaustive as Shape).kind}`);
    }
  }

  if (rendered.label) {
    const label = rendered.label;
    container.appendChild(label);
    label.style.opacity = '0';
    const baseY = Number(label.getAttribute('y'));
    handles.push(
      runTween({
        durationMs: LABEL_FADE_DURATION_MS,
        onFrame: (t) => {
          label.style.opacity = String(t);
          label.setAttribute('y', String(baseY + (1 - t) * 0.08));
        },
      })
    );
  }

  return runTweenGroup(handles);
}

// ---------------------------------------------------------------------------
// Restyle ("set") — animated crossfade between two visual states.
// ---------------------------------------------------------------------------

export function animateRestyle(node: SVGElement, from: Shape, to: Shape): TweenGroupHandle {
  const fromStyle = styleForShape(from);
  const toStyle = styleForShape(to);

  const handle = runTween({
    durationMs: RESTYLE_DURATION_MS,
    onFrame: (t) => {
      const strokeOpacity = lerp(fromStyle.strokeOpacity, toStyle.strokeOpacity, t);
      const strokeWidth = lerp(fromStyle.strokeWidth, toStyle.strokeWidth, t);
      node.setAttribute('stroke', t < 0.5 ? fromStyle.stroke : toStyle.stroke);
      node.setAttribute('stroke-opacity', String(strokeOpacity));
      node.setAttribute('stroke-width', String(strokeWidth));
      // Dash pattern flips at the midpoint rather than interpolating (dash
      // arrays don't tween meaningfully) — visually reads as part of the fade.
      if (t > 0.5) {
        if (toStyle.strokeDasharray) node.setAttribute('stroke-dasharray', toStyle.strokeDasharray);
        else node.removeAttribute('stroke-dasharray');
      } else {
        if (fromStyle.strokeDasharray) node.setAttribute('stroke-dasharray', fromStyle.strokeDasharray);
        else node.removeAttribute('stroke-dasharray');
      }
      if (toStyle.fill || fromStyle.fill) {
        const fillOpacity = lerp(
          fromStyle.fill ? fromStyle.fillOpacity : 0,
          toStyle.fill ? toStyle.fillOpacity : 0,
          t
        );
        node.setAttribute('fill', t < 0.5 ? fromStyle.fill ?? 'none' : toStyle.fill ?? 'none');
        node.setAttribute('fill-opacity', String(fillOpacity));
      }
    },
    onDone: () => {
      node.setAttribute('stroke', toStyle.stroke);
      node.setAttribute('stroke-opacity', String(toStyle.strokeOpacity));
      node.setAttribute('stroke-width', String(toStyle.strokeWidth));
      if (toStyle.strokeDasharray) node.setAttribute('stroke-dasharray', toStyle.strokeDasharray);
      else node.removeAttribute('stroke-dasharray');
      if (toStyle.fill) {
        node.setAttribute('fill', toStyle.fill);
        node.setAttribute('fill-opacity', String(toStyle.fillOpacity));
      }
      node.setAttribute('data-role', to.role);
    },
  });

  return runTweenGroup([handle]);
}

// ---------------------------------------------------------------------------
// Highlight pulse.
// ---------------------------------------------------------------------------

export function animateHighlight(node: SVGElement, baseStrokeWidth: number): TweenGroupHandle {
  const peakWidth = baseStrokeWidth * 2.2;
  const handle = runTween({
    durationMs: HIGHLIGHT_DURATION_MS,
    easing: easeInOutCubic,
    onFrame: (t) => {
      // Up then down: triangular envelope peaking at t=0.5.
      const envelope = t < 0.5 ? t * 2 : (1 - t) * 2;
      const width = lerp(baseStrokeWidth, peakWidth, envelope);
      node.setAttribute('stroke-width', String(width));
    },
    onDone: () => {
      node.setAttribute('stroke-width', String(baseStrokeWidth));
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
  if (style.strokeDasharray) node.setAttribute('stroke-dasharray', style.strokeDasharray);
  else node.removeAttribute('stroke-dasharray');
  node.removeAttribute('pathLength');
  node.style.strokeDashoffset = '';
  node.style.strokeDasharray = '';
  if (style.fill) {
    node.setAttribute('fill', style.fill);
    node.setAttribute('fill-opacity', String(style.fillOpacity));
  } else if (shape.kind === 'point') {
    node.setAttribute('fill', resolveFillOrStroke(shape.color));
    node.setAttribute('fill-opacity', '1');
  } else {
    node.setAttribute('fill', 'none');
  }
  node.setAttribute('data-role', shape.role);
  if (shape.kind === 'point') {
    node.setAttribute('r', String(POINT_RADIUS));
  }
}

// Re-export a couple of style constants some callers (timeline.ts) need
// without importing style.ts directly, keeping animate.ts as the animation
// surface API.
export { CONSTRUCTION_DASH, CONSTRUCTION_OPACITY, FILL_OPACITY, STROKE_WIDTH };
export type { Scene };
