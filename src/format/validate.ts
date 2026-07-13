// Load-time validation for proposition JSON. Runs before evaluation so
// the player can surface a useful error in its UI instead of throwing deep
// inside the evaluator or (worse) rendering garbage.

import type { AddOp, AddOpKind, Proposition, ProposedStep, SetOp } from './schema';

const KNOWN_ADD_OPS: readonly AddOpKind[] = [
  'point',
  'segment',
  'line',
  'ray',
  'circle',
  'intersect',
  'midpoint',
  'extend',
  'pointAtDistance',
  'footOfPerpendicular',
  'polygon',
  'angleMark',
];

const KNOWN_COLORS = ['black', 'red', 'yellow', 'blue', 'construction'];
const KNOWN_ROLES = ['normal', 'construction'];

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function stepLabel(step: ProposedStep, index: number): string {
  return step.id ?? `step[${index}]`;
}

/** Ids referenced by an add op that must already be resolvable (points or shapes). */
function referencedIds(op: AddOp): readonly string[] {
  switch (op.op) {
    case 'point':
      return op.at ? [] : [op.id]; // bare point referencing a `given` id
    case 'segment':
      return [op.from, op.to];
    case 'line':
      return [op.a, op.b];
    case 'ray':
      return [op.origin, op.through];
    case 'circle':
      return [op.center, op.through];
    case 'intersect':
      return [...op.of];
    case 'midpoint':
      return [op.a, op.b];
    case 'extend':
      return [op.from, op.through];
    case 'pointAtDistance':
      return [op.origin, op.through];
    case 'footOfPerpendicular':
      return [op.from, op.lineA, op.lineB];
    case 'polygon':
      return [...op.of];
    case 'angleMark':
      return [op.vertex, op.from, op.to];
    default: {
      return [];
    }
  }
}

/**
 * Validate a parsed proposition. Checks: required top-level fields present,
 * `given` coordinates well-formed, ids unique across given+steps, every op
 * is a known kind, every reference resolves to an id defined earlier
 * (given or an earlier step's add), `intersect.pick` is 0 or 1, `set`
 * targets exist, and colors/roles are known names.
 *
 * Never throws — returns a result with human-readable error strings so the
 * player can display them directly.
 */
export function validateProposition(prop: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof prop !== 'object' || prop === null) {
    return { valid: false, errors: ['proposition must be a JSON object'] };
  }

  const p = prop as Partial<Proposition>;

  if (typeof p.id !== 'string' || p.id.length === 0) {
    errors.push('missing or invalid "id" (expected non-empty string)');
  }
  if (typeof p.title !== 'string' || p.title.length === 0) {
    errors.push('missing or invalid "title" (expected non-empty string)');
  }
  // "view" is optional — when omitted, the frame is auto-computed from the
  // final step's geometry (kernel/bounds.ts). Validate only if present.
  if (p.view !== undefined && (typeof p.view !== 'object' || p.view === null)) {
    errors.push('invalid "view" (expected { x, y, width, height } or omit for auto-framing)');
  } else if (p.view) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (typeof p.view[key] !== 'number' || !Number.isFinite(p.view[key])) {
        errors.push(`"view.${key}" must be a finite number`);
      }
    }
    if (typeof p.view.width === 'number' && p.view.width <= 0) {
      errors.push('"view.width" must be positive');
    }
    if (typeof p.view.height === 'number' && p.view.height <= 0) {
      errors.push('"view.height" must be positive');
    }
  }

  const knownIds = new Set<string>();

  if (!p.given || typeof p.given !== 'object') {
    errors.push('missing or invalid "given" (expected a map of id -> [x, y])');
  } else {
    for (const [id, coords] of Object.entries(p.given)) {
      if (knownIds.has(id)) {
        errors.push(`duplicate id "${id}" (already defined in "given")`);
      }
      knownIds.add(id);
      if (
        !Array.isArray(coords) ||
        coords.length !== 2 ||
        typeof coords[0] !== 'number' ||
        typeof coords[1] !== 'number' ||
        !Number.isFinite(coords[0]) ||
        !Number.isFinite(coords[1])
      ) {
        errors.push(`"given.${id}" must be a [x, y] tuple of finite numbers`);
      }
    }
  }

  if (!Array.isArray(p.steps)) {
    errors.push('missing or invalid "steps" (expected an array)');
    return { valid: errors.length === 0, errors };
  }

  p.steps.forEach((step, index) => {
    const label = stepLabel(step, index);

    if (step.add !== undefined && !Array.isArray(step.add)) {
      errors.push(`${label}: "add" must be an array`);
    }
    if (step.set !== undefined && !Array.isArray(step.set)) {
      errors.push(`${label}: "set" must be an array`);
    }
    if (step.highlight !== undefined && !Array.isArray(step.highlight)) {
      errors.push(`${label}: "highlight" must be an array`);
    }

    const addOps: readonly AddOp[] = Array.isArray(step.add) ? step.add : [];

    for (const op of addOps) {
      if (!op || typeof op !== 'object' || typeof op.op !== 'string') {
        errors.push(`${label}: found an "add" entry that is not a valid op object`);
        continue;
      }
      if (!KNOWN_ADD_OPS.includes(op.op as AddOpKind)) {
        errors.push(`${label}: unknown op "${op.op}"`);
        continue;
      }
      if (typeof op.id !== 'string' || op.id.length === 0) {
        errors.push(`${label}: op "${op.op}" is missing a valid "id"`);
        continue;
      }
      if (op.op !== 'point' && knownIds.has(op.id)) {
        errors.push(`${label}: duplicate id "${op.id}"`);
      }
      if (op.color !== undefined && !KNOWN_COLORS.includes(op.color)) {
        errors.push(`${label}: op "${op.id}" has unknown color "${op.color}"`);
      }
      if (op.op === 'intersect' && op.pick !== 0 && op.pick !== 1) {
        errors.push(`${label}: intersect op "${op.id}" has invalid "pick" (must be 0 or 1)`);
      }
      if (op.op === 'point' && !op.at && !knownIds.has(op.id)) {
        errors.push(
          `${label}: point "${op.id}" has no "at" coordinates and is not a previously defined ("given") point`
        );
      }

      for (const ref of referencedIds(op)) {
        if (op.op === 'point' && ref === op.id) continue; // bare given-point reference, checked above
        if (!knownIds.has(ref)) {
          errors.push(`${label}: op "${op.id}" references unknown id "${ref}"`);
        }
      }

      knownIds.add(op.id);
    }

    const setOps: readonly SetOp[] = Array.isArray(step.set) ? step.set : [];
    for (const op of setOps) {
      if (!op || typeof op !== 'object' || !Array.isArray(op.targets)) {
        errors.push(`${label}: found a "set" entry missing a valid "targets" array`);
        continue;
      }
      for (const target of op.targets) {
        if (!knownIds.has(target)) {
          errors.push(`${label}: "set" references unknown id "${target}"`);
        }
      }
      if (op.role !== undefined && !KNOWN_ROLES.includes(op.role)) {
        errors.push(`${label}: "set" has unknown role "${op.role}"`);
      }
      if (op.color !== undefined && !KNOWN_COLORS.includes(op.color)) {
        errors.push(`${label}: "set" has unknown color "${op.color}"`);
      }
    }

    const highlightIds: readonly string[] = Array.isArray(step.highlight) ? step.highlight : [];
    for (const id of highlightIds) {
      if (!knownIds.has(id)) {
        errors.push(`${label}: "highlight" references unknown id "${id}"`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}
