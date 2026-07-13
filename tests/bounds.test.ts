import { describe, expect, it } from 'vitest';
import { computeViewBox } from '../src/kernel/bounds';
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
});
