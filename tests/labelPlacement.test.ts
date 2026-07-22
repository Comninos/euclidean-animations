import { describe, expect, it } from 'vitest';
import { placeLabel, labelAnchor } from '../src/render/labelPlacement';
import { LABEL_OFFSET } from '../src/render/style';
import type { Point, PointShape, Scene, Shape } from '../src/kernel/types';

function sceneOf(...shapes: Shape[]): Scene {
  return {
    order: shapes.map((s) => s.id),
    shapes: new Map(shapes.map((s) => [s.id, s])),
  };
}

function point(id: string, at: Point, extra: Partial<PointShape> = {}): PointShape {
  return {
    kind: 'point',
    id,
    at,
    color: 'black',
    role: 'normal',
    label: id,
    ...extra,
  };
}

function segment(id: string, from: Point, to: Point): Shape {
  return {
    kind: 'segment',
    id,
    from,
    to,
    color: 'black',
    role: 'normal',
  };
}

function angleMark(id: string, vertex: Point, from: Point, to: Point): Shape {
  return {
    kind: 'angleMark',
    id,
    vertex,
    from,
    to,
    color: 'black',
    role: 'normal',
  };
}

function dirFrom(anchor: Point, placed: Point): Point {
  const dx = placed.x - anchor.x;
  const dy = placed.y - anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

describe('placeLabel overrides', () => {
  it('labelOffset wins and is applied relative to the anchor', () => {
    const A = point('A', { x: 0, y: 0 }, { labelOffset: { x: 0.2, y: -0.1 } });
    const placement = placeLabel(A);
    expect(placement.position).toEqual({ x: 0.2, y: -0.1 });
  });

  it('labelSide places at LABEL_OFFSET along the compass direction', () => {
    const A = point('A', { x: 1, y: 2 }, { labelSide: 'W' });
    const placement = placeLabel(A);
    expect(placement.position.x).toBeCloseTo(1 - LABEL_OFFSET);
    expect(placement.position.y).toBeCloseTo(2);
  });

  it('labelOffset wins over labelSide', () => {
    const A = point('A', { x: 0, y: 0 }, {
      labelSide: 'E',
      labelOffset: { x: -0.5, y: 0.25 },
    });
    expect(placeLabel(A).position).toEqual({ x: -0.5, y: 0.25 });
  });

  it('defaults to northeast when no scene is provided', () => {
    const A = point('A', { x: 0, y: 0 });
    const d = dirFrom(A.at, placeLabel(A).position);
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.y).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('placeLabel angular-gap heuristic', () => {
  it('places opposite a single incident segment', () => {
    // A at origin, segment toward +x → free sector midpoint is −x (west).
    const A = point('A', { x: 0, y: 0 });
    const AB = segment('AB', { x: 0, y: 0 }, { x: 2, y: 0 });
    const placement = placeLabel(A, sceneOf(A, AB));
    const d = dirFrom(A.at, placement.position);
    expect(d.x).toBeCloseTo(-1);
    expect(d.y).toBeCloseTo(0);
  });

  it('places outside an equilateral triangle vertex', () => {
    // C at top of equilateral on AB; largest free gap is upward (exterior).
    const A = point('A', { x: -1, y: 0 });
    const B = point('B', { x: 1, y: 0 });
    const C = point('C', { x: 0, y: Math.sqrt(3) });
    const CA = segment('CA', C.at, A.at);
    const CB = segment('CB', C.at, B.at);
    const placement = placeLabel(C, sceneOf(A, B, C, CA, CB));
    const d = dirFrom(C.at, placement.position);
    expect(d.y).toBeGreaterThan(0.9);
    expect(Math.abs(d.x)).toBeLessThan(0.1);
  });

  it('prefers the gap outside an angle mark when both sectors exist', () => {
    // Horizontal line through A with an acute mark above → label goes below.
    const A = point('A', { x: 0, y: 0 });
    const left: Point = { x: -1, y: 0 };
    const right: Point = { x: 1, y: 0 };
    const up: Point = { x: 0, y: 1 };
    const AL = segment('AL', A.at, left);
    const AR = segment('AR', A.at, right);
    const AU = segment('AU', A.at, up);
    const mark = angleMark('m', A.at, right, up);
    const placement = placeLabel(A, sceneOf(A, AL, AR, AU, mark));
    const d = dirFrom(A.at, placement.position);
    // Mark occupies NE quadrant between E and N; largest unmarked gap is southish.
    expect(d.y).toBeLessThan(0);
  });

  it('ignores hidden edges when computing gaps', () => {
    const A = point('A', { x: 0, y: 0 });
    const visible = segment('AB', { x: 0, y: 0 }, { x: 1, y: 0 });
    const hidden: Shape = { ...segment('AC', { x: 0, y: 0 }, { x: 0, y: 1 }), role: 'hidden' };
    const placement = placeLabel(A, sceneOf(A, visible, hidden));
    const d = dirFrom(A.at, placement.position);
    expect(d.x).toBeCloseTo(-1);
    expect(d.y).toBeCloseTo(0);
  });

  it('with only an angle mark, places opposite the bisector', () => {
    const A = point('A', { x: 0, y: 0 });
    // Mark in the NE quadrant (E→N), bisector at 45°, opposite is SW.
    const mark = angleMark('m', A.at, { x: 1, y: 0 }, { x: 0, y: 1 });
    const placement = placeLabel(A, sceneOf(A, mark));
    const d = dirFrom(A.at, placement.position);
    expect(d.x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(d.y).toBeCloseTo(-Math.SQRT1_2, 5);
  });
});

describe('labelAnchor', () => {
  it('anchors points at their position and segments at their midpoint', () => {
    expect(labelAnchor(point('A', { x: 3, y: -1 }))).toEqual({ x: 3, y: -1 });
    expect(labelAnchor(segment('AB', { x: 0, y: 0 }, { x: 2, y: 4 }))).toEqual({ x: 1, y: 2 });
  });
});
