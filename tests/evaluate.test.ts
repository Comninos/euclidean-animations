import { describe, expect, it } from 'vitest';
import { evaluateAll, stateAt } from '../src/kernel/evaluate';
import { GeometryError, type CircleShape, type PointShape, type PolygonShape, type SegmentShape } from '../src/kernel/types';
import type { Proposition } from '../src/format/schema';

// Mirrors public/propositions/I.1.json structurally (kept inline so this
// test is self-contained and independent of the JSON file's evolution).
const propositionI1: Proposition = {
  id: 'I.1',
  title: 'On a given finite straight line to construct an equilateral triangle.',
  view: { x: -2.2, y: -1.6, width: 4.4, height: 3.2 },
  given: { A: [-1, 0], B: [1, 0] },
  steps: [
    {
      id: 'given-line',
      text: 'Let AB be the given finite straight line.',
      add: [
        { op: 'point', id: 'A', label: 'A' },
        { op: 'point', id: 'B', label: 'B' },
        { op: 'segment', id: 'AB', from: 'A', to: 'B', color: 'black' },
      ],
    },
    {
      id: 'circle-1',
      text: 'With centre A and radius AB, describe the circle BCD.',
      add: [{ op: 'circle', id: 'c1', center: 'A', through: 'B', color: 'red' }],
    },
    {
      id: 'circle-2',
      text: 'With centre B and radius BA, describe the circle ACE.',
      add: [{ op: 'circle', id: 'c2', center: 'B', through: 'A', color: 'blue' }],
    },
    {
      id: 'find-C',
      text: 'From point C, where the circles cut one another…',
      add: [{ op: 'intersect', id: 'C', of: ['c1', 'c2'], pick: 0, label: 'C' }],
    },
    {
      id: 'draw-CA-CB',
      text: '…draw the straight lines CA and CB.',
      add: [
        { op: 'segment', id: 'CA', from: 'C', to: 'A', color: 'red' },
        { op: 'segment', id: 'CB', from: 'C', to: 'B', color: 'blue' },
      ],
      set: [{ targets: ['c1', 'c2'], role: 'construction' }],
    },
    {
      id: 'qed',
      text: 'Then ABC is an equilateral triangle.',
      add: [{ op: 'polygon', id: 'ABC', of: ['A', 'B', 'C'], fill: 'yellow' }],
      highlight: ['AB', 'CA', 'CB'],
    },
  ],
};

describe('stateAt: incremental evaluation', () => {
  it('stateAt(0) has no shapes yet', () => {
    const scene = stateAt(propositionI1, 0);
    expect(scene.order).toEqual([]);
  });

  it('stateAt(1) resolves A, B and segment AB', () => {
    const scene = stateAt(propositionI1, 1);
    expect(scene.order).toEqual(['A', 'B', 'AB']);
    const a = scene.shapes.get('A') as PointShape;
    expect(a.at).toEqual({ x: -1, y: 0 });
    const ab = scene.shapes.get('AB') as SegmentShape;
    expect(ab.from).toEqual({ x: -1, y: 0 });
    expect(ab.to).toEqual({ x: 1, y: 0 });
  });

  it('stateAt(3) resolves both circles with radius 2', () => {
    const scene = stateAt(propositionI1, 3);
    const c1 = scene.shapes.get('c1') as CircleShape;
    const c2 = scene.shapes.get('c2') as CircleShape;
    expect(c1.radius).toBeCloseTo(2);
    expect(c2.radius).toBeCloseTo(2);
    expect(c1.through).toEqual({ x: 1, y: 0 });
    expect(c2.through).toEqual({ x: -1, y: 0 });
  });

  it('full evaluation: intersection pick 0 is C = (0, sqrt(3)) — the ground-truth Euclid I.1 apex', () => {
    const scene = stateAt(propositionI1, propositionI1.steps.length);
    const c = scene.shapes.get('C') as PointShape;
    expect(c.at.x).toBeCloseTo(0, 10);
    expect(c.at.y).toBeCloseTo(Math.sqrt(3), 10);
  });

  it('final scene contains the filled equilateral triangle with correct vertices', () => {
    const scene = stateAt(propositionI1, propositionI1.steps.length);
    const tri = scene.shapes.get('ABC') as PolygonShape;
    expect(tri.points).toEqual([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: Math.sqrt(3) },
    ]);
    expect(tri.fill).toBe('yellow');
  });

  it('the "set" step demotes both circles to construction role', () => {
    const scene = stateAt(propositionI1, 5); // after draw-CA-CB step
    const c1 = scene.shapes.get('c1') as CircleShape;
    const c2 = scene.shapes.get('c2') as CircleShape;
    expect(c1.role).toBe('construction');
    expect(c2.role).toBe('construction');
  });

  it('circles keep their normal role before the demoting step runs', () => {
    const scene = stateAt(propositionI1, 4); // before draw-CA-CB step
    const c1 = scene.shapes.get('c1') as CircleShape;
    expect(c1.role).toBe('normal');
  });

  it('stepping backward (lower stepCount) is a pure re-fold, not a mutation', () => {
    const full = stateAt(propositionI1, propositionI1.steps.length);
    const partial = stateAt(propositionI1, 1);
    expect(full.order.length).toBeGreaterThan(partial.order.length);
    expect(partial.shapes.has('C')).toBe(false);
    // Evaluating the same stepCount twice gives equal (not just equal-reference) results.
    const again = stateAt(propositionI1, 1);
    expect([...again.shapes.keys()]).toEqual([...partial.shapes.keys()]);
  });

  it('evaluateAll returns one scene per step index 0..steps.length inclusive', () => {
    const scenes = evaluateAll(propositionI1);
    expect(scenes).toHaveLength(propositionI1.steps.length + 1);
    expect(scenes[0]?.order).toEqual([]);
    expect(scenes[scenes.length - 1]?.shapes.has('ABC')).toBe(true);
  });
});

describe('evaluate: error handling names the offending step', () => {
  it('throws a GeometryError naming the step id for an unresolvable reference', () => {
    const bad: Proposition = {
      id: 'bad',
      title: 'bad',
      view: { x: -1, y: -1, width: 2, height: 2 },
      given: { A: [0, 0] },
      steps: [
        {
          id: 'broken-step',
          add: [{ op: 'segment', id: 'seg', from: 'A', to: 'ghost' }],
        },
      ],
    };
    expect(() => stateAt(bad, 1)).toThrow(GeometryError);
    try {
      stateAt(bad, 1);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GeometryError);
      expect((e as GeometryError).stepId).toBe('broken-step');
      expect((e as Error).message).toContain('broken-step');
      expect((e as Error).message).toContain('ghost');
    }
  });

  it('throws a GeometryError for tangent circles surfaced through evaluation', () => {
    const bad: Proposition = {
      id: 'tangent',
      title: 'tangent',
      view: { x: -3, y: -2, width: 6, height: 4 },
      given: { A: [-1, 0], B: [1, 0], C: [0, 0], D: [2, 0] },
      steps: [
        {
          id: 'circles',
          add: [
            { op: 'circle', id: 'c1', center: 'C', through: 'A' },
            { op: 'circle', id: 'c2', center: 'D', through: 'B' },
          ],
        },
        {
          id: 'bad-intersect',
          add: [{ op: 'intersect', id: 'X', of: ['c1', 'c2'], pick: 0 }],
        },
      ],
    };
    expect(() => stateAt(bad, 2)).toThrow(GeometryError);
    try {
      stateAt(bad, 2);
      expect.unreachable();
    } catch (e) {
      expect((e as GeometryError).stepId).toBe('bad-intersect');
    }
  });

  it('defaults step id to step[index] when no explicit id is given', () => {
    const bad: Proposition = {
      id: 'noid',
      title: 'noid',
      view: { x: -1, y: -1, width: 2, height: 2 },
      given: {},
      steps: [{ add: [{ op: 'segment', id: 'seg', from: 'missing1', to: 'missing2' }] }],
    };
    try {
      stateAt(bad, 1);
      expect.unreachable();
    } catch (e) {
      expect((e as GeometryError).stepId).toBe('step[0]');
    }
  });
});
