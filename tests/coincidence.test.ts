import { describe, expect, it } from 'vitest';
import type { Scene, Shape } from '../src/kernel/types';
import { strokeCovers, suppressedStrokeIds } from '../src/render/coincidence';

const A = { x: -1, y: 0 };
const B = { x: 1, y: 0 };
const C = { x: 0, y: Math.sqrt(3) };

function segment(id: string, from = A, to = B): Shape {
  return { kind: 'segment', id, from, to, color: 'black', role: 'normal' };
}

function polygon(id: string, points = [A, B, C]): Shape {
  return { kind: 'polygon', id, points, color: 'black', role: 'normal' };
}

function circle(id: string, center = A, radius = 2): Shape {
  return { kind: 'circle', id, center, radius, color: 'black', role: 'normal' };
}

function sceneOf(...shapes: Shape[]): Scene {
  return {
    order: shapes.map((s) => s.id),
    shapes: new Map(shapes.map((s) => [s.id, s])),
  };
}

describe('strokeCovers', () => {
  it('matches segments with reversed endpoints', () => {
    expect(strokeCovers(segment('upper', B, A), segment('lower', A, B))).toBe(true);
  });

  it('does not match distinct segments', () => {
    expect(strokeCovers(segment('upper', A, C), segment('lower', A, B))).toBe(false);
  });

  it('lets a polygon cover each of its edges', () => {
    const tri = polygon('ABC');
    expect(strokeCovers(tri, segment('AB', A, B))).toBe(true);
    expect(strokeCovers(tri, segment('BC', B, C))).toBe(true);
    expect(strokeCovers(tri, segment('CA', C, A))).toBe(true);
  });

  it('does not let a segment cover a polygon', () => {
    expect(strokeCovers(segment('AB'), polygon('ABC'))).toBe(false);
  });

  it('matches identical circles', () => {
    expect(strokeCovers(circle('c2'), circle('c1'))).toBe(true);
    expect(strokeCovers(circle('c2', A, 3), circle('c1', A, 2))).toBe(false);
  });
});

describe('suppressedStrokeIds', () => {
  it('suppresses segments under a later coincident polygon', () => {
    const scene = sceneOf(
      segment('AB', A, B),
      segment('BC', B, C),
      segment('CA', C, A),
      polygon('ABC')
    );
    expect([...suppressedStrokeIds(scene)].sort()).toEqual(['AB', 'BC', 'CA']);
  });

  it('suppresses an earlier duplicate segment', () => {
    const scene = sceneOf(segment('first'), segment('second', B, A));
    expect(suppressedStrokeIds(scene)).toEqual(new Set(['first']));
  });

  it('ignores hidden covers', () => {
    const cover = { ...polygon('ABC'), role: 'hidden' as const };
    const scene = sceneOf(segment('AB'), cover);
    expect(suppressedStrokeIds(scene).size).toBe(0);
  });

  it('does not suppress the topmost stroke', () => {
    const scene = sceneOf(segment('AB'), polygon('ABC'));
    expect(suppressedStrokeIds(scene).has('ABC')).toBe(false);
  });
});
