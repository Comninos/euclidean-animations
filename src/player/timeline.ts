// Step-indexed timeline state machine. This is the critical correctness
// piece described in the plan: NO global clock. `stateAt(k)` is a pure fold
// (see kernel/evaluate.ts); this module drives an SVG stage through that
// sequence of snapshots, animating transitions between them.
//
// Correctness requirement: stepping or seeking while a transition is mid
// animation must cancel the running tween(s) and leave the stage in a
// clean, fully-static state for the *target* step — never a half-drawn
// frame left over from an abandoned animation.

import { stateAt } from '../kernel/evaluate';
import type { Scene, Shape } from '../kernel/types';
import type { Proposition } from '../format/schema';
import { animateAdd, animateRestyle, applyStaticStyle, prefersReducedMotion } from '../render/animate';
import { renderShape, renderScene, type RenderedShape } from '../render/svg';

export type PlayState = 'paused' | 'playing';

export interface TimelineEvents {
  onStepChange?: (step: number, total: number) => void;
  onPlayStateChange?: (state: PlayState) => void;
}

const BEAT_PAUSE_MS = 550;

/** Tracks the SVG nodes currently on stage for each shape id, so later
 * steps (restyle, highlight, or a future removal) can find and mutate them
 * instead of re-rendering the whole scene from scratch. */
interface StageEntry {
  node: SVGElement;
  label: SVGTextElement | null;
}

export class Timeline {
  private readonly prop: Proposition;
  private readonly container: SVGElement;
  private readonly events: TimelineEvents;

  private step = 0;
  private playState: PlayState = 'paused';

  /** Handle(s) for whatever tween/animation is currently in flight, if any.
   * Always cancelled before starting a new one or jumping via goTo. */
  private activeAnimation: { cancel(): void; finishInstantly(): void; done: Promise<void> } | null = null;
  /** Guards play() so overlapping play() calls don't race each other. */
  private playToken = 0;

  private stageEntries = new Map<string, StageEntry>();

  /** While a forward transition is in flight, this holds the step index
   * being animated *to* (this.step is still the pre-transition step until
   * it commits). Used so back/goTo/restart during an in-flight animation
   * cancel from the correct reference point instead of using a stale
   * `this.step`. */
  private animatingTarget: number | null = null;

  constructor(prop: Proposition, container: SVGElement, events: TimelineEvents = {}) {
    this.prop = prop;
    this.container = container;
    this.events = events;
    this.renderStatic(0);
  }

  get currentStep(): number {
    return this.step;
  }

  get totalSteps(): number {
    return this.prop.steps.length;
  }

  get state(): PlayState {
    return this.playState;
  }

  /** The step index accounting for an in-flight forward transition: while
   * animating from k to k+1, this is k+1 (the step we're committing to),
   * even though `this.step` (the settled value) doesn't update until the
   * animation's promise resolves. Backward/seek operations must reason
   * about this value, not the stale settled `this.step`, or a fast
   * back-tap during a forward animation would silently no-op. */
  private get effectiveStep(): number {
    return this.animatingTarget ?? this.step;
  }

  get isAtStart(): boolean {
    return this.effectiveStep <= 0;
  }

  get isAtEnd(): boolean {
    return this.effectiveStep >= this.totalSteps;
  }

  /** Cancel whatever animation is currently running, if any. Safe to call
   * when nothing is running. */
  private cancelActive(): void {
    if (this.activeAnimation) {
      this.activeAnimation.cancel();
      this.activeAnimation = null;
    }
    this.animatingTarget = null;
    this.playToken++; // invalidate any in-flight play() loop
  }

  /** Wipe the stage and statically render `stateAt(k)`. Used for restart,
   * step-back, seeking, and as the guaranteed-clean landing state after any
   * cancellation. */
  private renderStatic(k: number): void {
    this.cancelActive();
    const scene = stateAt(this.prop, k);
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.stageEntries.clear();
    const g = renderScene(scene);
    // Re-index rendered nodes into stageEntries by walking the scene again
    // (renderScene doesn't hand back the per-id map, so rebuild it here to
    // keep svg.ts's static path independent/simple).
    for (const id of scene.order) {
      const shape = scene.shapes.get(id);
      if (!shape) continue;
      const node = g.querySelector(`[data-id="${cssEscape(id)}"]`) as SVGElement | null;
      const label = g.querySelector(`[data-id="${cssEscape(id)}__label"]`) as SVGTextElement | null;
      if (node) this.stageEntries.set(id, { node, label });
    }
    this.container.appendChild(g);
    this.markCurrentStep(this.currentStepIds(k));
    this.step = k;
    this.playState = 'paused';
    this.events.onStepChange?.(this.step, this.totalSteps);
    this.events.onPlayStateChange?.(this.playState);
  }

  /** Ids of the shapes the k-th step (1-based) adds, unioned with the ids
   * it lists in `highlight`; empty at step 0. Both sets render in red via
   * the data-current attribute (see markCurrentStep). */
  private currentStepIds(k: number): readonly string[] {
    const step = k > 0 ? this.prop.steps[k - 1] : undefined;
    if (!step) return [];
    const added = step.add?.map((op) => op.id) ?? [];
    const highlighted = step.highlight ?? [];
    return [...new Set([...added, ...highlighted])];
  }

  /** Tag the given shapes (and their labels) as the "current" step's
   * geometry via a data-current attribute, clearing it everywhere else.
   * [data-current] elements render in the accent color (see
   * euclid-player.ts) so the newest construction — and anything the step
   * explicitly highlights — stands out. */
  private markCurrentStep(ids: readonly string[]): void {
    const current = new Set(ids);
    for (const [id, entry] of this.stageEntries) {
      const on = current.has(id);
      entry.node.toggleAttribute('data-current', on);
      entry.label?.toggleAttribute('data-current', on);
    }
  }

  /** Render `stateAt(k)` instantly (no animation), cancelling any running
   * transition first. Used by restart, step dots, and step-back. */
  goTo(k: number): void {
    const clamped = Math.max(0, Math.min(k, this.totalSteps));
    this.renderStatic(clamped);
  }

  restart(): void {
    this.goTo(0);
  }

  /** Animate the transition from stateAt(step) to stateAt(step+1). If
   * already at the end, this is a no-op. If an animation is already
   * running, it is cancelled and the stage is snapped to a clean state at
   * the *current* step before the new transition begins (so stepping
   * rapidly never corrupts the drawing). Returns a promise that resolves
   * when the transition's animation completes (or is cancelled). */
  async stepForward(): Promise<void> {
    // If something is mid-flight, fast-forward it: snap to a clean static
    // state at the step it was animating *to* (committing that step), then
    // animate the next one from there. Snapping to the settled `this.step`
    // instead would restart the same transition on every rapid click,
    // making it impossible to advance past the first step by clicking
    // quickly. renderStatic clears activeAnimation/animatingTarget, so
    // effectiveStep === this.step again immediately after.
    if (this.activeAnimation) {
      this.renderStatic(this.effectiveStep);
    }

    if (this.isAtEnd) return;

    const targetStep = this.step + 1;
    this.animatingTarget = targetStep;
    const currentScene = stateAt(this.prop, this.step);
    const nextScene = stateAt(this.prop, targetStep);
    const stepDef = this.prop.steps[this.step];

    const addedIds = nextScene.order.filter((id) => !currentScene.shapes.has(id));
    const changedRoleIds = nextScene.order.filter((id) => {
      if (!currentScene.shapes.has(id)) return false;
      const before = currentScene.shapes.get(id) as Shape;
      const after = nextScene.shapes.get(id) as Shape;
      return before.role !== after.role || before.color !== after.color;
    });
    // `highlight` ids are shapes from *this or an earlier* step that should
    // also read as "current" (in red) alongside whatever gets added — e.g.
    // the QED step calling out the sides it just proved equal.
    const highlightIds = stepDef?.highlight ?? [];

    const groupHandles: { cancel(): void; finishInstantly(): void; done: Promise<void> }[] = [];

    // The incoming step's shapes plus anything it highlights become the
    // "current" set (drawn in the accent color), so the newest construction
    // — and whatever the step calls out — stands out. The attribute goes on
    // before animateAdd so the circle sweep's temporary arc path can
    // inherit it.
    this.markCurrentStep([...new Set([...addedIds, ...highlightIds])]);
    for (const id of addedIds) {
      const shape = nextScene.shapes.get(id);
      if (!shape) continue;
      const rendered: RenderedShape = renderShape(shape);
      rendered.node.setAttribute('data-current', '');
      rendered.label?.setAttribute('data-current', '');
      const handle = animateAdd(this.container, shape, rendered);
      this.stageEntries.set(id, { node: rendered.node, label: rendered.label });
      groupHandles.push(handle);
    }

    for (const id of changedRoleIds) {
      const entry = this.stageEntries.get(id);
      const before = currentScene.shapes.get(id);
      const after = nextScene.shapes.get(id);
      if (!entry || !before || !after) continue;
      const handle = animateRestyle(entry.node, before, after, entry.label);
      groupHandles.push(handle);
    }

    const combined = {
      cancel: () => groupHandles.forEach((h) => h.cancel()),
      finishInstantly: () => groupHandles.forEach((h) => h.finishInstantly()),
      done: Promise.all(groupHandles.map((h) => h.done)).then(() => undefined),
    };
    this.activeAnimation = combined;

    await combined.done;

    // Only commit the step advance if this animation wasn't superseded by
    // a cancellation (renderStatic clears activeAnimation on cancel).
    if (this.activeAnimation === combined) {
      this.activeAnimation = null;
      this.animatingTarget = null;
      this.step = targetStep;
      this.events.onStepChange?.(this.step, this.totalSteps);
    }
  }

  /** Render stateAt(effectiveStep - 1) instantly. Backward stepping is
   * always instant per the plan (only forward steps animate). If a forward
   * transition is mid-flight, it is cancelled first and backward stepping
   * is computed from the step it was animating *to* (the step the user
   * perceives as "current"), not the stale pre-transition settled step —
   * otherwise a back-tap during a forward animation would silently no-op
   * and then get clobbered when the abandoned animation later completes. */
  stepBackward(): void {
    if (this.isAtStart) return;
    const base = this.effectiveStep;
    this.renderStatic(base - 1);
  }

  /** Chain stepForward() calls with a short beat pause until the end is
   * reached or pause()/goTo()/stepBackward() interrupts. */
  async play(): Promise<void> {
    if (this.playState === 'playing') return;
    this.playState = 'playing';
    this.events.onPlayStateChange?.(this.playState);
    const token = ++this.playToken;

    while (this.playToken === token && !this.isAtEnd) {
      await this.stepForward();
      if (this.playToken !== token) return; // interrupted mid-step
      if (this.isAtEnd) break;
      await beat(BEAT_PAUSE_MS, () => this.playToken !== token);
      if (this.playToken !== token) return;
    }

    if (this.playToken === token) {
      this.playState = 'paused';
      this.events.onPlayStateChange?.(this.playState);
    }
  }

  pause(): void {
    if (this.playState !== 'playing') return;
    this.playToken++; // interrupt the play() loop after its current await
    this.playState = 'paused';
    this.events.onPlayStateChange?.(this.playState);
    // Let any in-flight step transition finish naturally (don't corrupt a
    // half-drawn shape); only the *beat pause between* steps is skipped.
  }

  togglePlay(): void {
    if (this.playState === 'playing') this.pause();
    else void this.play();
  }
}

/** Await a short pause, but resolve early (without the full delay) if
 * `interrupted()` becomes true — polled on each animation frame so pause()
 * during the beat responds immediately rather than after the full delay. */
function beat(ms: number, interrupted: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    // Fallback timer: rAF is suspended in hidden tabs, and play() would
    // otherwise hang between steps until the page became visible again.
    const timerId = setTimeout(() => resolve(), ms);
    function tick(now: number) {
      if (interrupted() || now - start >= ms) {
        clearTimeout(timerId);
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id);
  return id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// applyStaticStyle / prefersReducedMotion are re-exported for potential
// direct use by euclid-player.ts (e.g. reacting to a live media-query
// change without a full timeline reconstruction).
export { applyStaticStyle, prefersReducedMotion };
export type { Scene };
