import { describe, expect, it } from 'vitest';
import { computePropositionViewBox, computeViewBox } from '../src/kernel/bounds';
import { stateAt } from '../src/kernel/evaluate';
import type { Proposition } from '../src/format/schema';

const I1_LIKE: Proposition = {
  id: 'test-I.1',
  title: 'Equilateral triangle on AB',
  given: { A: [-1, 0], B: [1, 0] },
  steps: [
    {
      add: [
        { op: 'point', id: 'A' },
        { op: 'point', id: 'B' },
        { op: 'segment', id: 'AB', from: 'A', to: 'B' },
      ],
    },
    { add: [{ op: 'circle', id: 'c1', center: 'A', through: 'B' }] },
    { add: [{ op: 'circle', id: 'c2', center: 'B', through: 'A' }] },
    { add: [{ op: 'intersect', id: 'C', of: ['c1', 'c2'], pick: 0 }] },
  ],
};

describe('computeViewBox', () => {
  it('frames the final scene including full circle extents', () => {
    const view = computeViewBox(stateAt(I1_LIKE, I1_LIKE.steps.length));
    // c1 spans x in [-3, 1], c2 spans x in [-1, 3]; both span y in [-2, 2].
    // The frame must contain all of it (plus padding).
    expect(view.x).toBeLessThan(-3);
    expect(view.x + view.width).toBeGreaterThan(3);
    expect(view.y).toBeLessThan(-2);
    expect(view.y + view.height).toBeGreaterThan(2);
    // ...but not by an absurd amount (padding is bounded).
    expect(view.width).toBeLessThan(8);
    expect(view.height).toBeLessThan(6);
  });

  it('frames intersection points found mid-construction', () => {
    const view = computeViewBox(stateAt(I1_LIKE, I1_LIKE.steps.length));
    const c = { x: 0, y: Math.sqrt(3) };
    expect(c.x).toBeGreaterThan(view.x);
    expect(c.x).toBeLessThan(view.x + view.width);
    expect(c.y).toBeGreaterThan(view.y);
    expect(c.y).toBeLessThan(view.y + view.height);
  });

  it('returns a renderable degenerate box for an empty scene', () => {
    const view = computeViewBox({ order: [], shapes: new Map() });
    expect(view.width).toBeGreaterThan(0);
    expect(view.height).toBeGreaterThan(0);
  });

  it('excludes hidden shapes from a single-scene frame', () => {
    const withHiddenCircles: Proposition = {
      ...I1_LIKE,
      steps: [
        ...I1_LIKE.steps,
        { set: [{ targets: ['c1', 'c2'], role: 'hidden' }] },
      ],
    };
    const view = computeViewBox(stateAt(withHiddenCircles, withHiddenCircles.steps.length));
    // Without the circles, only A/B/C and AB remain — well inside the
    // circle extents. The floor on view extent still expands the box for
    // stroke scale, but it must not be driven by the hidden circles
    // (those span x ∈ [-3, 3]).
    expect(view.width).toBe(5.5);
    expect(view.height).toBe(5.5);
    expect(view.x).toBeGreaterThan(-3.5);
    expect(view.x + view.width).toBeLessThan(3.5);
  });

  it('floors small frames so compact diagrams do not over-scale strokes', () => {
    const tiny: Proposition = {
      id: 'tiny',
      title: 'tiny',
      given: { A: [0, 0], B: [1, 0] },
      steps: [
        {
          add: [
            { op: 'point', id: 'A' },
            { op: 'point', id: 'B' },
            { op: 'segment', id: 'AB', from: 'A', to: 'B' },
          ],
        },
      ],
    };
    const view = computePropositionViewBox(tiny);
    expect(view.width).toBe(5.5);
    expect(view.height).toBe(5.5);
    // Content stays centered in the floored frame.
    expect(view.x + view.width / 2).toBeCloseTo(0.5, 5);
  });

  it('proposition frame covers scaffolding while it is visible, even if later hidden', () => {
    const withHiddenCircles: Proposition = {
      ...I1_LIKE,
      steps: [
        ...I1_LIKE.steps,
        { set: [{ targets: ['c1', 'c2'], role: 'hidden' }] },
      ],
    };
    // The circles (spanning x in [-3, 3], y in [-2, 2]) are visible during
    // the middle steps, so the whole-proposition frame must contain them —
    // otherwise they would be clipped exactly while they are on stage.
    const view = computePropositionViewBox(withHiddenCircles);
    expect(view.x).toBeLessThan(-3);
    expect(view.x + view.width).toBeGreaterThan(3);
    expect(view.y).toBeLessThan(-2);
    expect(view.y + view.height).toBeGreaterThan(2);
  });
});
