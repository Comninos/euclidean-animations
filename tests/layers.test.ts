/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import type { Scene, Shape } from '../src/kernel/types';
import {
  appendRenderedShape,
  GEOMETRY_LAYERS,
  geometryLayerFor,
  LABELS_LAYER_CLASS,
  placeShapeInLayer,
  renderScene,
  renderShape,
} from '../src/render/svg';

const A = { x: 0, y: 0 };
const B = { x: 1, y: 0 };

function segment(
  id: string,
  role: Shape['role'] = 'normal',
  color: Shape['color'] = 'black'
): Shape {
  return { kind: 'segment', id, from: A, to: B, color, role };
}

function point(id: string, role: Shape['role'] = 'normal', label = id): Shape {
  return { kind: 'point', id, at: A, color: 'black', role, label };
}

function sceneOf(...shapes: Shape[]): Scene {
  return {
    order: shapes.map((s) => s.id),
    shapes: new Map(shapes.map((s) => [s.id, s])),
  };
}

describe('geometryLayerFor', () => {
  it('puts construction strokes under ink', () => {
    expect(geometryLayerFor({ kind: 'segment', role: 'construction' })).toBe('euclid-construction');
    expect(geometryLayerFor({ kind: 'segment', role: 'normal' })).toBe('euclid-ink');
    expect(geometryLayerFor({ kind: 'circle', role: 'hidden' })).toBe('euclid-ink');
  });

  it('keeps points above strokes regardless of role', () => {
    expect(geometryLayerFor({ kind: 'point', role: 'normal' })).toBe('euclid-points');
    expect(geometryLayerFor({ kind: 'point', role: 'construction' })).toBe('euclid-points');
  });

  it('ignores color when choosing a band', () => {
    // color: "construction" is a tint, not a layer — only role demotes to dashes.
    expect(geometryLayerFor({ kind: 'segment', role: 'normal' })).toBe('euclid-ink');
  });
});

describe('stage paint order', () => {
  it('exposes the canonical bottom→top geometry bands', () => {
    expect([...GEOMETRY_LAYERS]).toEqual([
      'euclid-construction',
      'euclid-ink',
      'euclid-points',
    ]);
  });

  it('stacks construction under ink under points under labels', () => {
    const scene = sceneOf(
      segment('dash', 'construction'),
      segment('side', 'normal'),
      point('A'),
      point('B', 'normal', 'B')
    );
    const root = renderScene(scene);
    const children = [...root.children].map((n) => (n as Element).getAttribute('class'));
    expect(children).toEqual(['euclid-geometry', LABELS_LAYER_CLASS]);

    const geometry = root.querySelector(':scope > .euclid-geometry')!;
    const bands = [...geometry.children].map((n) => (n as Element).getAttribute('class'));
    expect(bands).toEqual([...GEOMETRY_LAYERS]);

    expect(geometry.querySelector('.euclid-construction [data-id="dash"]')).toBeTruthy();
    expect(geometry.querySelector('.euclid-ink [data-id="side"]')).toBeTruthy();
    expect(geometry.querySelector('.euclid-points [data-id="A"]')).toBeTruthy();
    expect(root.querySelector(`.${LABELS_LAYER_CLASS} [data-id="A__label"]`)).toBeTruthy();
  });

  it('puts later adds on top within a band', () => {
    const scene = sceneOf(segment('first'), segment('second'));
    const root = renderScene(scene);
    const ink = root.querySelector('.euclid-ink')!;
    const ids = [...ink.children].map((n) => (n as Element).getAttribute('data-id'));
    expect(ids).toEqual(['first', 'second']);
  });

  it('moves a demoted stroke into the construction band without promoting peers', () => {
    const container = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const older = segment('older', 'construction');
    const newer = segment('newer', 'normal');
    appendRenderedShape(container, renderShape(older), older);
    appendRenderedShape(container, renderShape(newer), newer);

    const ink = container.querySelector('.euclid-ink')!;
    const construction = container.querySelector('.euclid-construction')!;
    const newerNode = ink.querySelector('[data-id="newer"]') as SVGElement;
    expect(newerNode).toBeTruthy();

    // Demote: must leave the construction band's existing order alone for
    // `older`, and land `newer` as the last child of construction.
    placeShapeInLayer(container, newerNode, { kind: 'segment', role: 'construction' });
    expect(newerNode.parentNode).toBe(construction);
    expect([...construction.children].map((n) => (n as Element).getAttribute('data-id'))).toEqual([
      'older',
      'newer',
    ]);
  });

  it('does not promote within a band on same-band restyle', () => {
    const container = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const first = segment('first');
    const second = segment('second');
    appendRenderedShape(container, renderShape(first), first);
    appendRenderedShape(container, renderShape(second), second);

    const ink = container.querySelector('.euclid-ink')!;
    const firstNode = ink.querySelector('[data-id="first"]') as SVGElement;
    // Color-only / normal→hidden would call placeShapeInLayer with the same band.
    placeShapeInLayer(container, firstNode, { kind: 'segment', role: 'hidden' });
    expect([...ink.children].map((n) => (n as Element).getAttribute('data-id'))).toEqual([
      'first',
      'second',
    ]);
  });

  it('keeps labels above geometry after repeated appends', () => {
    const container = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const a = point('A');
    const side = segment('AB');
    appendRenderedShape(container, renderShape(a), a);
    appendRenderedShape(container, renderShape(side), side);
    const classes = [...container.children].map((n) => (n as Element).getAttribute('class'));
    expect(classes).toEqual(['euclid-geometry', LABELS_LAYER_CLASS]);
  });
});
