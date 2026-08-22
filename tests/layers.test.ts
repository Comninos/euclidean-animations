import { describe, expect, it } from 'vitest';
import { geometryLayerFor } from '../src/render/svg';

describe('geometryLayerFor', () => {
  it('puts construction strokes under ink', () => {
    expect(geometryLayerFor({ kind: 'segment', role: 'construction' })).toBe('euclid-construction');
    expect(geometryLayerFor({ kind: 'segment', role: 'normal' })).toBe('euclid-ink');
  });

  it('keeps points above strokes regardless of role', () => {
    expect(geometryLayerFor({ kind: 'point', role: 'normal' })).toBe('euclid-points');
    expect(geometryLayerFor({ kind: 'point', role: 'construction' })).toBe('euclid-points');
  });
});
