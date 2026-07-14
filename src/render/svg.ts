// Static SVG rendering: turn a resolved Scene (kernel/types.ts `Shape`s)
// into SVG DOM elements, instantly (no animation). Used for the very first
// paint, for step-back (goTo), and as the "jump to end state" fallback for
// prefers-reduced-motion / cancelled tweens.
//
// Coordinate convention: the kernel/JSON plane is y-up (math convention).
// SVG is y-down. We flip y at render time by negating the y coordinate of
// every point AND flipping the viewBox's y origin, so authors can write
// natural math coordinates in proposition JSON.

import type { AngleMarkShape, Point, Scene, Shape } from '../kernel/types';
import { styleForShape, LABEL_FONT_FAMILY, LABEL_FONT_STYLE, LABEL_FONT_SIZE, LABEL_OFFSET, POINT_RADIUS, resolveFillOrStroke, roleFillOpacity } from './style';
import type { ViewBox } from '../format/schema';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Flip a plane-space (y-up) point into SVG-space (y-down). */
export function toSvgPoint(p: Point): Point {
  return { x: p.x, y: -p.y };
}

/** Map a plane `view` box (y-up) to an SVG viewBox string (y-down). */
export function viewBoxAttr(view: ViewBox): string {
  // Flipping y: the new top edge is -(view.y + view.height).
  const svgY = -(view.y + view.height);
  return `${view.x} ${svgY} ${view.width} ${view.height}`;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function setAttrs(node: SVGElement, attrs: Record<string, string | number | null | undefined>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
}

function applyStrokeAttrs(node: SVGElement, shape: Shape): void {
  const style = styleForShape(shape);
  setAttrs(node, {
    stroke: style.stroke,
    'stroke-width': style.strokeWidth,
    'stroke-opacity': style.strokeOpacity,
    'stroke-dasharray': style.strokeDasharray,
    'stroke-linecap': style.lineCap,
    'stroke-linejoin': style.lineJoin,
    fill: 'none',
  });
}

function pathD(points: readonly Point[], close: boolean): string {
  const pts = points.map(toSvgPoint);
  if (pts.length === 0) return '';
  const first = pts[0];
  if (!first) return '';
  const rest = pts.slice(1);
  const parts = [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)];
  if (close) parts.push('Z');
  return parts.join(' ');
}

function createLabel(anchor: Point, text: string, color: string): SVGTextElement {
  const svgP = toSvgPoint(anchor);
  const label = el('text');
  setAttrs(label, {
    x: svgP.x + LABEL_OFFSET,
    y: svgP.y - LABEL_OFFSET,
    'font-family': LABEL_FONT_FAMILY,
    'font-style': LABEL_FONT_STYLE,
    'font-size': LABEL_FONT_SIZE,
    fill: color,
    'text-anchor': 'start',
    class: 'euclid-label',
  });
  label.textContent = text;
  return label;
}

/** Result of rendering one shape: the primary geometry node plus an
 * optional label node, both tagged with data-id for animation lookup. */
export interface RenderedShape {
  readonly id: string;
  readonly node: SVGElement;
  readonly label: SVGTextElement | null;
}

function midOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function angleMarkPath(shape: AngleMarkShape): string {
  // Small arc between the two direction vectors from the vertex, at a
  // fixed radius, purely for a visual angle wedge indicator. The arc's
  // centre must be the (y-flipped) vertex — SVG's endpoint-arc syntax
  // recovers a centre from the flags, and a hardcoded sweep always picks
  // one of two candidate centres, which can put the bulge on the wrong
  // side of the angle (a "concave" mark). Compute sweep from the SVG-
  // space central angle so the intended centre is selected. Always the
  // minor arc (|Δ| ≤ π) — reflex angles are not supported.
  const radius = LABEL_OFFSET * 1.4;
  const v = shape.vertex;
  const dirFrom = normalizeDir(shape.from, v);
  const dirTo = normalizeDir(shape.to, v);
  const start = { x: v.x + dirFrom.x * radius, y: v.y + dirFrom.y * radius };
  const end = { x: v.x + dirTo.x * radius, y: v.y + dirTo.y * radius };
  const centerSvg = toSvgPoint(v);
  const startSvg = toSvgPoint(start);
  const endSvg = toSvgPoint(end);
  const a0 = Math.atan2(startSvg.y - centerSvg.y, startSvg.x - centerSvg.x);
  const a1 = Math.atan2(endSvg.y - centerSvg.y, endSvg.x - centerSvg.x);
  let delta = a1 - a0;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  // In SVG's y-down atan2, a positive delta is clockwise — which is
  // sweep-flag 1. Zero delta is degenerate; either flag is fine.
  const sweep = delta >= 0 ? 1 : 0;
  return `M ${startSvg.x} ${startSvg.y} A ${radius} ${radius} 0 0 ${sweep} ${endSvg.x} ${endSvg.y}`;
}

function normalizeDir(p: Point, from: Point): Point {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Render a single resolved shape into SVG element(s). Does not attach to
 * the DOM; caller appends `node` (and `label` if present) to the stage. */
export function renderShape(shape: Shape): RenderedShape {
  let node: SVGElement;

  switch (shape.kind) {
    case 'point': {
      const p = toSvgPoint(shape.at);
      const circle = el('circle');
      setAttrs(circle, { cx: p.x, cy: p.y, r: POINT_RADIUS });
      applyStrokeAttrs(circle, shape);
      setAttrs(circle, { fill: resolveFillOrStroke(shape.color), 'fill-opacity': roleFillOpacity(shape.role) });
      node = circle;
      break;
    }
    case 'segment': {
      const line = el('path');
      setAttrs(line, { d: pathD([shape.from, shape.to], false) });
      applyStrokeAttrs(line, shape);
      node = line;
      break;
    }
    case 'line': {
      const line = el('path');
      setAttrs(line, { d: pathD([shape.a, shape.b], false) });
      applyStrokeAttrs(line, shape);
      node = line;
      break;
    }
    case 'ray': {
      const line = el('path');
      setAttrs(line, { d: pathD([shape.origin, shape.through], false) });
      applyStrokeAttrs(line, shape);
      node = line;
      break;
    }
    case 'circle': {
      const c = toSvgPoint(shape.center);
      const circle = el('circle');
      setAttrs(circle, { cx: c.x, cy: c.y, r: shape.radius });
      applyStrokeAttrs(circle, shape);
      node = circle;
      break;
    }
    case 'polygon': {
      const poly = el('path');
      setAttrs(poly, { d: pathD(shape.points, true) });
      applyStrokeAttrs(poly, shape);
      node = poly;
      break;
    }
    case 'angleMark': {
      const mark = el('path');
      setAttrs(mark, { d: angleMarkPath(shape) });
      applyStrokeAttrs(mark, shape);
      setAttrs(mark, { fill: 'none' });
      node = mark;
      break;
    }
    default: {
      const exhaustive: never = shape;
      throw new Error(`renderShape: unhandled shape kind ${(exhaustive as Shape).kind}`);
    }
  }

  node.setAttribute('data-id', shape.id);
  node.setAttribute('data-kind', shape.kind);
  node.setAttribute('data-role', shape.role);

  let label: SVGTextElement | null = null;
  if (shape.label) {
    const anchor = labelAnchor(shape);
    label = createLabel(anchor, shape.label, resolveFillOrStroke(shape.color));
    label.setAttribute('data-id', `${shape.id}__label`);
    label.setAttribute('opacity', String(roleFillOpacity(shape.role)));
  }

  return { id: shape.id, node, label };
}

function labelAnchor(shape: Shape): Point {
  switch (shape.kind) {
    case 'point':
      return shape.at;
    case 'segment':
      return midOf(shape.from, shape.to);
    case 'line':
      return midOf(shape.a, shape.b);
    case 'ray':
      return shape.through;
    case 'circle':
      return { x: shape.center.x, y: shape.center.y + shape.radius };
    case 'polygon': {
      const n = shape.points.length || 1;
      const sum = shape.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      return { x: sum.x / n, y: sum.y / n };
    }
    case 'angleMark':
      return shape.vertex;
    default:
      return { x: 0, y: 0 };
  }
}

/** Render a full scene into a fresh <g> element, statically (no animation).
 * This is the function step-back / seek / prefers-reduced-motion use.
 * Geometry is painted first, then every label, so labels always sit above
 * strokes regardless of construction order. */
export function renderScene(scene: Scene): SVGGElement {
  const g = el('g');
  g.setAttribute('class', 'euclid-scene');
  const geometry = el('g');
  geometry.setAttribute('class', 'euclid-geometry');
  const labels = el('g');
  labels.setAttribute('class', 'euclid-labels');
  for (const id of scene.order) {
    const shape = scene.shapes.get(id);
    if (!shape) continue;
    const rendered = renderShape(shape);
    geometry.appendChild(rendered.node);
    if (rendered.label) labels.appendChild(rendered.label);
  }
  g.appendChild(geometry);
  g.appendChild(labels);
  return g;
}

/** Append a rendered shape's geometry (and label) so labels stay in a
 * trailing `.euclid-labels` group above all strokes. Used by animated
 * step-forward, which paints directly into the stage SVG. */
export function appendRenderedShape(container: SVGElement, rendered: RenderedShape): void {
  let geometry = container.querySelector(':scope > .euclid-geometry') as SVGGElement | null;
  let labels = container.querySelector(':scope > .euclid-labels') as SVGGElement | null;
  if (!geometry) {
    geometry = el('g');
    geometry.setAttribute('class', 'euclid-geometry');
    container.appendChild(geometry);
  }
  if (!labels) {
    labels = el('g');
    labels.setAttribute('class', 'euclid-labels');
    container.appendChild(labels);
  }
  geometry.appendChild(rendered.node);
  if (rendered.label) labels.appendChild(rendered.label);
  // Keep the labels group last among direct children so it stays on top
  // even if other nodes (e.g. temporary circle-sweep paths) were appended
  // after it earlier.
  container.appendChild(labels);
}

/** Create the root <svg> element for a proposition's stage with the
 * y-flipped viewBox. The stage background comes from the player's CSS
 * (var(--euclid-background) on the host/stage-wrap), not an SVG rect —
 * a rect child would be wiped by the timeline's renderStatic anyway. */
export function createStageSvg(view: ViewBox): SVGSVGElement {
  const svg = el('svg');
  setAttrs(svg, {
    viewBox: viewBoxAttr(view),
    xmlns: SVG_NS,
    class: 'euclid-stage',
    'preserveAspectRatio': 'xMidYMid meet',
  });
  return svg;
}
