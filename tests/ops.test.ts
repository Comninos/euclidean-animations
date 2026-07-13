import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  distance,
  extend,
  footOfPerpendicular,
  intersectCircleCircle,
  intersectLineCircle,
  intersectLineLine,
  midpoint,
  pointAtDistance,
  rotate90ccw,
} from '../src/kernel/ops';
import { GeometryError, type Point } from '../src/kernel/types';

const A: Point = { x: -1, y: 0 };
const B: Point = { x: 1, y: 0 };

describe('basic vector helpers', () => {
  it('distance computes Euclidean distance', () => {
    expect(distance(A, B)).toBeCloseTo(2);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
  });

  it('midpoint averages coordinates', () => {
    expect(midpoint(A, B)).toEqual({ x: 0, y: 0 });
  });

  it('rotate90ccw rotates a vector 90 degrees counter-clockwise', () => {
    const r1 = rotate90ccw({ x: 1, y: 0 });
    expect(r1.x).toBeCloseTo(0);
    expect(r1.y).toBeCloseTo(1);
    const r2 = rotate90ccw({ x: 0, y: 1 });
    expect(r2.x).toBeCloseTo(-1);
    expect(r2.y).toBeCloseTo(0);
  });
});

describe('intersectCircleCircle', () => {
  it('returns pick 0 as the point counter-clockwise (left) of the center1->center2 vector', () => {
    // A=(-1,0), B=(1,0), both radius 2 (through each other). d = B - A points +x.
    // "Left" of +x is +y, so pick 0 should be the point with positive y: (0, sqrt(3)).
    const [p0, p1] = intersectCircleCircle({ center: A, radius: 2 }, { center: B, radius: 2 }, 'test');
    expect(p0.x).toBeCloseTo(0);
    expect(p0.y).toBeCloseTo(Math.sqrt(3));
    expect(p1.x).toBeCloseTo(0);
    expect(p1.y).toBeCloseTo(-Math.sqrt(3));
  });

  it('is symmetric under swapping which circle is "first" (pick flips left/right accordingly)', () => {
    // Swapping center1/center2 reverses d, so left/right (pick 0/1) should swap too.
    const [p0, p1] = intersectCircleCircle({ center: B, radius: 2 }, { center: A, radius: 2 }, 'test');
    expect(p0.y).toBeCloseTo(-Math.sqrt(3));
    expect(p1.y).toBeCloseTo(Math.sqrt(3));
  });

  it('handles off-axis centers correctly (rotated configuration)', () => {
    // Rotate the A/B configuration 90 degrees: centers at (0,-1) and (0,1).
    const c1 = { center: { x: 0, y: -1 }, radius: 2 };
    const c2 = { center: { x: 0, y: 1 }, radius: 2 };
    // d = (0,2) i.e. +y direction; left of +y is -x. So pick 0 should have negative x.
    const [p0, p1] = intersectCircleCircle(c1, c2, 'test');
    expect(p0.x).toBeCloseTo(-Math.sqrt(3));
    expect(p0.y).toBeCloseTo(0);
    expect(p1.x).toBeCloseTo(Math.sqrt(3));
    expect(p1.y).toBeCloseTo(0);
  });

  it('throws a step-named error for externally tangent circles', () => {
    const c1 = { center: { x: -1, y: 0 }, radius: 1 };
    const c2 = { center: { x: 1, y: 0 }, radius: 1 };
    expect(() => intersectCircleCircle(c1, c2, 'tangentStep')).toThrow(GeometryError);
    try {
      intersectCircleCircle(c1, c2, 'tangentStep');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GeometryError);
      expect((e as GeometryError).stepId).toBe('tangentStep');
      expect((e as Error).message).toContain('tangentStep');
      expect((e as Error).message.toLowerCase()).toContain('tangent');
    }
  });

  it('throws a step-named error for internally tangent circles', () => {
    const c1 = { center: { x: 0, y: 0 }, radius: 1 };
    const c2 = { center: { x: 1, y: 0 }, radius: 2 };
    expect(() => intersectCircleCircle(c1, c2, 'internalTangent')).toThrow(GeometryError);
  });

  it('throws a step-named error for circles too far apart', () => {
    const c1 = { center: { x: -10, y: 0 }, radius: 1 };
    const c2 = { center: { x: 10, y: 0 }, radius: 1 };
    expect(() => intersectCircleCircle(c1, c2, 'noHit')).toThrow(GeometryError);
    try {
      intersectCircleCircle(c1, c2, 'noHit');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('noHit');
    }
  });

  it('throws a step-named error for one circle entirely inside another', () => {
    const c1 = { center: { x: 0, y: 0 }, radius: 5 };
    const c2 = { center: { x: 0.1, y: 0 }, radius: 1 };
    expect(() => intersectCircleCircle(c1, c2, 'nested')).toThrow(GeometryError);
  });

  it('throws for concentric circles', () => {
    const c1 = { center: { x: 0, y: 0 }, radius: 1 };
    const c2 = { center: { x: 0, y: 0 }, radius: 2 };
    expect(() => intersectCircleCircle(c1, c2, 'concentric')).toThrow(GeometryError);
  });
});

describe('intersectLineCircle', () => {
  it('returns points ordered by walking distance along the line direction (pick 0 met first)', () => {
    // Horizontal line through origin, circle centered at origin radius 1.
    // Walking from (-5,0) toward (5,0), we meet (-1,0) first, then (1,0).
    const line = { a: { x: -5, y: 0 }, b: { x: 5, y: 0 } };
    const circle = { center: { x: 0, y: 0 }, radius: 1 };
    const [p0, p1] = intersectLineCircle(line, circle, 'test');
    expect(p0.x).toBeCloseTo(-1);
    expect(p0.y).toBeCloseTo(0);
    expect(p1.x).toBeCloseTo(1);
    expect(p1.y).toBeCloseTo(0);
  });

  it('reverses pick order when the line direction is reversed', () => {
    const line = { a: { x: 5, y: 0 }, b: { x: -5, y: 0 } };
    const circle = { center: { x: 0, y: 0 }, radius: 1 };
    const [p0, p1] = intersectLineCircle(line, circle, 'test');
    expect(p0.x).toBeCloseTo(1);
    expect(p1.x).toBeCloseTo(-1);
  });

  it('throws a step-named error for a tangent line', () => {
    const line = { a: { x: -5, y: 1 }, b: { x: 5, y: 1 } };
    const circle = { center: { x: 0, y: 0 }, radius: 1 };
    expect(() => intersectLineCircle(line, circle, 'tangentLine')).toThrow(GeometryError);
    try {
      intersectLineCircle(line, circle, 'tangentLine');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('tangentLine');
      expect((e as Error).message.toLowerCase()).toContain('tangent');
    }
  });

  it('throws a step-named error when the line misses the circle entirely', () => {
    const line = { a: { x: -5, y: 5 }, b: { x: 5, y: 5 } };
    const circle = { center: { x: 0, y: 0 }, radius: 1 };
    expect(() => intersectLineCircle(line, circle, 'missStep')).toThrow(GeometryError);
    try {
      intersectLineCircle(line, circle, 'missStep');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('missStep');
    }
  });

  it('throws for a degenerate line (coincident points)', () => {
    const line = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
    const circle = { center: { x: 0, y: 0 }, radius: 1 };
    expect(() => intersectLineCircle(line, circle, 'degenerate')).toThrow(GeometryError);
  });
});

describe('intersectLineLine', () => {
  it('finds the intersection of two crossing lines', () => {
    const l1 = { a: { x: -1, y: -1 }, b: { x: 1, y: 1 } };
    const l2 = { a: { x: -1, y: 1 }, b: { x: 1, y: -1 } };
    const p = intersectLineLine(l1, l2, 'test');
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it('throws a step-named error for parallel lines', () => {
    const l1 = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    const l2 = { a: { x: 0, y: 1 }, b: { x: 1, y: 1 } };
    expect(() => intersectLineLine(l1, l2, 'parallelStep')).toThrow(GeometryError);
    try {
      intersectLineLine(l1, l2, 'parallelStep');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('parallelStep');
    }
  });

  it('throws a step-named error for coincident lines', () => {
    const l1 = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    const l2 = { a: { x: 2, y: 0 }, b: { x: 5, y: 0 } };
    expect(() => intersectLineLine(l1, l2, 'coincidentStep')).toThrow(GeometryError);
  });
});

describe('midpoint / extend / pointAtDistance / footOfPerpendicular / angleBetween', () => {
  it('extend returns the point at an absolute distance from `a` toward `b`', () => {
    const p = extend(A, B, 4, 'test');
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(0);
  });

  it('pointAtDistance is equivalent to extend for these semantics', () => {
    const p = pointAtDistance(A, B, 1, 'test');
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it('footOfPerpendicular drops the perpendicular from a point onto a line', () => {
    const foot = footOfPerpendicular({ x: 0, y: 5 }, { x: -1, y: 0 }, { x: 1, y: 0 }, 'test');
    expect(foot.x).toBeCloseTo(0);
    expect(foot.y).toBeCloseTo(0);
  });

  it('angleBetween computes the unsigned angle at a vertex', () => {
    const vertex = { x: 0, y: 0 };
    const p = { x: 1, y: 0 };
    const q = { x: 0, y: 1 };
    expect(angleBetween(vertex, p, q, 'test')).toBeCloseTo(Math.PI / 2);
  });

  it('extend throws for a degenerate direction', () => {
    expect(() => extend(A, A, 1, 'degenStep')).toThrow(GeometryError);
  });
});
