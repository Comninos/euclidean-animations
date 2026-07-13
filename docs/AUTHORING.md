# Authoring a proposition

This is the complete reference for the proposition JSON format: every field,
every operation, every failure mode, and the visual conventions the shipped
propositions follow. It is written so that a human *or* an LLM agent can be
handed this document plus the text of a Euclidean (or other
compass-and-straightedge) proposition and produce a working `FILE.json` with
no other context.

Everything here is verified against the source, not guessed. Where this
document says "X happens," that claim traces to a specific line in
`src/format/schema.ts`, `src/format/validate.ts`, `src/kernel/evaluate.ts`,
`src/kernel/ops.ts`, `src/kernel/bounds.ts`, `src/render/svg.ts`,
`src/render/style.ts`, `src/render/animate.ts`, or `src/player/timeline.ts`.
If you find a place where this guide and the code disagree, the code is
right — please fix the guide.

For embedding, theming, and the project's file layout, see `README.md`; this
document does not repeat that material.

## 1. Mental model

A proposition is a **declarative list of steps evaluated by a small
geometry kernel**. You never draw anything or place anything in pixel
space — you write down what gets constructed from what (`op: "circle",
center: "A", through: "B"`) and the kernel (`src/kernel/evaluate.ts`)
computes concrete coordinates by folding your `given` points and each
step's `add`/`set` operations in order. The renderer then turns the
resulting shapes into SVG; you never touch SVG, and the same JSON drives
both the static render and the step animations.

**One step is one logical beat of the construction, and one step is
exactly one step-forward click** in the player (`src/player/timeline.ts`,
`Timeline.stepForward`). A step can add several shapes at once (e.g. two
circles that get described "simultaneously" in Euclid's text), restyle
earlier shapes, and/or highlight existing shapes — all of that happens as
one animated transition when the reader clicks forward once. Group operations
into a step the way Euclid's own sentences group them: "describe the circle
BCD" is one step; "from the point C draw CA and CB" is one step; the closing
"therefore ABC is equilateral" is usually its own step with a `polygon` and a
`highlight`.

Coordinates in `given` and in any `at: [x, y]` are an **abstract, unitless,
y-up plane** — not pixels, not an SVG viewBox you pick yourself. Authors
never choose a viewBox. Instead, the frame is computed automatically as the
union of **every step's visible geometry**, plus a small padding margin —
see `computePropositionViewBox` in `src/kernel/bounds.ts`. This guarantees
nothing is ever clipped at any step, including scaffolding that a later
step sets to `role: "hidden"`: it counts toward the frame for the steps in
which it is visible. The design consequence for authors: **big scaffolding
costs figure size even if you hide it later**, because the frame must
accommodate it while it is on stage — prefer sub-constructions whose
geometry stays within (or near) the extent of the final figure. You can
override the computed frame with a top-level `"view"` object when you
deliberately want a tighter or off-center crop, but this is the exception,
not the default.

## 2. File anatomy

A complete, annotated skeleton:

```jsonc
{
  // Unique identifier, also used as the file's basename convention
  // (public/propositions/I.1.json has "id": "I.1"). Required, non-empty
  // string (src/format/validate.ts).
  "id": "I.1",

  // Shown as the bold title line above the caption in the player.
  // Required, non-empty string.
  "title": "On a given finite straight line to construct an equilateral triangle.",

  // OPTIONAL. Explicit viewBox override, world-space (y-up), in the same
  // plane units as "given"/"at". Omit this in the normal case — see
  // section 1. When present, all four fields are required finite numbers
  // and width/height must be positive (src/format/validate.ts).
  // "view": { "x": -1.5, "y": -1.2, "width": 3, "height": 2.4 },

  // Map of point-id -> [x, y] literal coordinates. These are the fixed
  // starting data of the construction (the points Euclid's proposition
  // text calls "given"). Every id here is a point that later steps may
  // reference without re-supplying coordinates.
  "given": { "A": [-1, 0], "B": [1, 0] },

  // Ordered array of steps. Each step is one step-forward click.
  "steps": [
    {
      // OPTIONAL. Explicit step id, used to name this step in error
      // messages. Defaults to "step[<index>]" if omitted (src/format/validate.ts
      // stepLabel, src/kernel/evaluate.ts applyStep). Giving every step an
      // id makes validator/kernel errors far more readable — always do this.
      "id": "given-line",

      // OPTIONAL. Caption shown in the player while/after this step plays.
      // Not validated for presence — a step may have no text (I.2's final
      // "qed" step in this repo has no "add", only "highlight").
      "text": "Let AB be the given finite straight line.",

      // OPTIONAL. Array of "add" operations — new points/shapes created in
      // this step. See section 3 for every op kind.
      "add": [
        { "op": "point", "id": "A", "label": "A" },
        { "op": "point", "id": "B", "label": "B" },
        { "op": "segment", "id": "AB", "from": "A", "to": "B" }
      ],

      // OPTIONAL. Array of "set" operations — restyle shapes that were
      // added in this step or any earlier step. See section 4.
      "set": [
        { "targets": ["AB"], "role": "construction" }
      ],

      // OPTIONAL. Ids of existing shapes to mark "current" (red accent)
      // for this step, in addition to whatever "add" just created.
      // See section 4.
      "highlight": ["AB"]
    }
  ]
}
```

Field-by-field notes worth calling out explicitly:

- **Ids are global and must be unique.** `given` keys and every `add` op's
  `id` share one namespace; the validator flags `duplicate id "X"` if you
  reuse one (`src/format/validate.ts`), with one deliberate exception: a
  bare `point` op whose `id` matches an existing `given` id is *not* a
  duplicate — it's how you make a `given` point visible (see the `point`
  op in section 3).
- **References must resolve to something defined earlier** — either a
  `given` point or an earlier step's `add`. There is no forward reference
  and no same-step self-reference. The validator checks this
  (`referencedIds` in `src/format/validate.ts`) and the evaluator
  re-checks it at eval time with a friendlier "check spelling / step
  order" message (`requirePoint`/`requireShape` in
  `src/kernel/evaluate.ts`).
- **`steps` may be empty**, and a step's `add`/`set`/`highlight` may all be
  omitted (a text-only step, or — as I.2's final step does — a
  highlight-only step with no `add` at all).
- **Colors and roles are closed vocabularies.** Colors:
  `"black" | "red" | "yellow" | "blue" | "construction"`. Roles:
  `"normal" | "construction" | "hidden"`. Anything else is a validator
  error (`unknown color`/`unknown role`). Note `"construction"` is a legal
  value in *both* lists and they are independent — see section 5.

## 3. Operations reference

Every `add` op shares three optional base fields in addition to its own:
`id` (required, unique — see above), `label` (optional text drawn next to
the shape), `color` (optional, defaults to `"black"`). All fields below are
exactly as declared in `src/format/schema.ts`; failure modes are exactly as
thrown in `src/kernel/ops.ts` / `src/kernel/evaluate.ts`.

### `point`

```json
{ "op": "point", "id": "A", "at": [-1, 0], "label": "A" }
```

Fields: `at?: [x, y]`. If `at` is present, this places a point at literal
coordinates. If `at` is **omitted**, `id` must be the id of a point already
known (typically a `given` point) — this is how you make a `given` point
*visible* on stage without re-specifying its coordinates: `{ "op": "point",
"id": "A", "label": "A" }` where `A` is in `given`. This is exactly the
pattern I.1 and I.2 use for their given points.

Failure modes: `point "X" has no "at" coordinates and is not a previously
defined ("given") point` (validator); the evaluator throws the analogous
`point "X" has no coordinates and is not a pre-given point` if this somehow
slips past validation.

### `segment`

```json
{ "op": "segment", "id": "AB", "from": "A", "to": "B" }
```

Fields: `from`, `to` (point ids). A finite straight line between two
concrete points. Renders as a straight stroke between exactly those two
points — nothing beyond either endpoint.

### `line`

```json
{ "op": "line", "id": "ax", "a": "A", "b": "B" }
```

Fields: `a`, `b` (point ids) — **not** `from`/`to` (that's `segment`/`ray`).
An *infinite* line, but rendered as a straight stroke drawn only between
points `a` and `b` (`src/render/svg.ts renderShape`, case `'line'`, calls
`pathD([shape.a, shape.b], false)`) — the renderer does not extrapolate the
line beyond `a`/`b` onto the frame edges. If you need the line to visually
reach further than `a`–`b`, place `a`/`b` far enough apart yourself, or use
`extend`/`pointAtDistance` to manufacture a farther point and use that as
`b`. The only functional difference from `segment` is in `intersect`: a
`line` is treated as infinite for intersection math (`intersectLineLine`,
`intersectLineCircle` extrapolate along the `a`→`b` direction), so a `line`
can validly intersect a circle or another line beyond its drawn extent even
though the drawn stroke itself stops at `a`/`b`.

### `ray`

```json
{ "op": "ray", "id": "AB", "origin": "A", "through": "B" }
```

Fields: `origin`, `through` (point ids).

**Rendering caveat (verified in `src/render/svg.ts`): a `ray` renders
*only* the segment from `origin` to `through` — it does NOT draw extended
beyond `through`, despite being treated as semi-infinite for intersection
math** (`lineLike` in `src/kernel/evaluate.ts` maps a ray to `{ a: origin,
b: through }` for intersection purposes, same as `line`). This means a
`ray` used to intersect something far beyond `through` will compute the
correct point, but the stroke on stage will visibly stop short of it unless
`through` itself is already placed past the intersection.

For Euclid's "produce AB to E" pattern (a straight line extended past one
of its defining points to a new lettered point), do **not** rely on `ray`'s
extrapolation. Instead use the `extend` op to compute the new point at an
explicit distance, then draw a `segment` to it — this is exactly the
pattern I.2 uses for "Produce the straight lines AE, BF in a straight line
with DA, DB":

```json
{ "op": "extend", "id": "E", "from": "D", "through": "A", "distance": 3.0, "label": "E" },
{ "op": "segment", "id": "AE", "from": "A", "to": "E" }
```

This both draws the produced line correctly out to the new point *and*
gives you a real lettered point (`E`) to label and to intersect other
circles against later, matching how Euclid's own text names produced
points.

### `circle`

```json
{ "op": "circle", "id": "c1", "center": "A", "through": "B" }
```

Fields: `center`, `through` (point ids). Computes `radius =
distance(center, through)` (`src/kernel/evaluate.ts`). `through` is also
semantically "the point the compass was drawn from" and is used by the
animator as the start point of the compass arc-sweep draw-on (see section
5's "not just circle-1/circle-2 naming — through matters for the
animation").

### `intersect`

```json
{ "op": "intersect", "id": "C", "of": ["c1", "c2"], "pick": 0, "label": "C" }
```

Fields: `of: [idA, idB]` (two shape ids — points cannot be intersected,
only lines/segments/rays/circles), `pick: 0 | 1`. Produces a **point**
(referenceable afterward exactly like any other point). Supports
circle–circle, line–circle (in either order — line-like vs circle is
detected structurally, not by argument position), and line–line, where
"line-like" covers `line`, `segment`, and `ray` shapes interchangeably
(`lineLike()` in `src/kernel/evaluate.ts`).

**The pick convention (exact, from the header comment in
`src/format/schema.ts` and `src/kernel/ops.ts`, locked in by
`tests/ops.test.ts`):**

- **circle–circle**: let `d = center(second circle) - center(first
  circle)` (i.e. `of[1]`'s center minus `of[0]`'s center). `pick: 0` is the
  intersection point on the **left** of `d` — the point you reach by
  rotating `d` +90° counter-clockwise into the intersection half-plane.
  `pick: 1` is the mirror point on the right.
  **Worked example** (this exact case is a unit test): centers `A=(-1,0)`,
  `B=(1,0)`, both circles radius 2 (`of: ["circleAtA", "circleAtB"]`). `d`
  points in `+x`. "Left" of `+x` is `+y`. So `pick: 0` = `(0, +√3)` (above
  the AB line), `pick: 1` = `(0, -√3)` (below). **Swapping the order of
  `of` swaps which physical point is pick 0 vs pick 1** — the convention is
  relative to `of[0]`→`of[1]`, not to the shapes' identities.
- **line–circle**: order the two `of` shapes however you like; internally,
  points are ordered by walking along the line-like shape's direction
  vector (`from`→`to` for a line, `origin`→`through` for a ray) starting
  from its first defining point. `pick: 0` is whichever solution has the
  smaller parameter `t` along that direction (met first walking forward);
  `pick: 1` is met second. Concrete case from `tests/ops.test.ts`: a
  horizontal line through `(-5,0)`→`(5,0)` against a unit circle at the
  origin — walking from `-5` toward `+5`, you meet `(-1,0)` first, so
  `pick: 0 = (-1,0)`, `pick: 1 = (1,0)`. Reversing the line's own
  `from`/`to` (or `origin`/`through`) reverses which point is pick 0.
- **line–line**: exactly one solution always exists (or the op throws —
  see failure modes below); `pick` **must be `0`** even though there is
  only one answer — this is enforced (`line-line intersection has only one
  solution; "pick" must be 0 (got N)`), purely so a stray `1` doesn't
  silently pass validation.

Failure modes (all `GeometryError`s that name the offending step id, so a
player error always tells you *which step* is wrong):

- Circles too far apart to intersect: `circles are too far apart to
  intersect (separate circles)`.
- One circle entirely inside the other: `one circle lies entirely inside
  the other (no intersection)`.
- Circles externally or internally **tangent** (single point, not two):
  `circles are tangent (single intersection point) — this op requires two
  distinct solutions`. **This is the most common authoring mistake** — see
  section 5 on choosing radii that clearly cross rather than nearly touch.
- Concentric circles: `circles are concentric — no well-defined
  intersection`.
- Line tangent to circle: `line is tangent to circle (single intersection
  point) — this op requires two distinct solutions`.
- Line misses circle entirely: `line and circle do not intersect`.
- Parallel or coincident lines: `lines are parallel (or coincident) — no
  unique intersection`.
- Two points coincide (degenerate direction): errors mentioning
  "degenerate" (e.g. `cannot intersect a degenerate line (a and b
  coincide) with a circle`).
- Referencing a shape kind pair that isn't line-like/circle at all (e.g.
  trying to intersect two polygons): `cannot intersect shapes of kind "X"
  and "Y"`.

### `midpoint`

```json
{ "op": "midpoint", "id": "M", "a": "A", "b": "B" }
```

Fields: `a`, `b` (point ids). The arithmetic mean of the two points. No
failure modes (always well-defined).

### `extend`

```json
{ "op": "extend", "id": "E", "from": "D", "through": "A", "distance": 3.0 }
```

Fields: `from`, `through` (point ids), `distance` (number). Computes the
point at the given **absolute distance from `from`**, in the direction
`from`→`through`. This is Euclid's "produce the line DA to a point E" —
`from` is the point you're producing *away from*, `through` is the point
the line already passes through on its way out, `distance` is measured
from `from`, not from `through`. In I.2, `{ "from": "D", "through": "A",
"distance": 3.0 }` produces a point 3.0 units from `D`, out past `A` (since
`distance` there is larger than `|DA|`).

Failure mode: `cannot normalize a zero-length vector (two points
coincide)` if `from` and `through` are the same point.

Note the doc comment in `src/kernel/ops.ts` states negative distances
aren't supported by this op (use `pointAtDistance` with the direction
reversed — i.e. swap which point is `origin`/`through` — if you need the
opposite direction).

### `pointAtDistance`

```json
{ "op": "pointAtDistance", "id": "G", "origin": "A", "through": "C", "distance": 1.4 }
```

Fields: `origin`, `through` (point ids), `distance` (number). Computes the
point at the given absolute distance from `origin`, in the direction
`origin`→`through`. Functionally identical arithmetic to `extend` (both
call `normalize` then scale-and-add) — the difference is purely naming:
`pointAtDistance` reads naturally for "cut off a length equal to X" (as in
Euclid I.3 or I.9's "cut off AE equal to AD"), while `extend` reads
naturally for "produce the line to a point beyond it." Choose whichever
name matches Euclid's verb in your source text; there is no behavioral
reason to prefer one over the other when `from`/`origin` and
`through`/`through` are the same two points.

Failure mode: same zero-length-vector error as `extend`.

### `footOfPerpendicular`

```json
{ "op": "footOfPerpendicular", "id": "H", "from": "P", "lineA": "A", "lineB": "B" }
```

Fields: `from` (the point the perpendicular is dropped from), `lineA`,
`lineB` (two points spanning the line to drop onto — the line is treated
as infinite). Computes the foot of the perpendicular from `from` onto the
infinite line through `lineA`/`lineB` via vector projection.

Failure mode: `cannot drop a perpendicular onto a degenerate line (a and b
coincide)` if `lineA` and `lineB` coincide.

### `polygon`

```json
{ "op": "polygon", "id": "ABC", "of": ["A", "B", "C"] }
```

Fields: `of: string[]` (three or more point ids, in order). **Outline
only** — the renderer strokes the closed path (`pathD(shape.points, true)`
in `src/render/svg.ts`, which appends `Z`) with `fill: 'none'`; there is no
fill option and no way to shade a polygon's interior. Use this for the
"therefore ABC is the required triangle" closing shape, not for shading.

### `angleMark`

```json
{ "op": "angleMark", "id": "mark1", "vertex": "A", "from": "B", "to": "C" }
```

Fields: `vertex`, `from`, `to` (point ids). Draws a small decorative arc
wedge at `vertex`, spanning the directions toward `from` and `to`, at a
small fixed radius (`LABEL_OFFSET * 1.4` in plane units — independent of
how far `from`/`to` actually are from `vertex`). The renderer always draws
the **minor** arc (`src/render/svg.ts` comment: "small-angle assumption:
always draw the minor arc") — this op is meant for calling out an acute or
otherwise "normal-looking" angle, not for marking reflex angles, which will
render incorrectly (the small arc on the wrong side).

## 4. Step verbs

A step (`ProposedStep` in `src/format/schema.ts`) has three independent
verbs. Any combination — including none of them (a pure caption step) — is
valid.

### `add`

Array of ops from section 3. Each op both computes new geometry and
introduces exactly one new id (except `point` referencing a `given` id,
which reuses that id). Newly-added shapes are the step's "current" set by
default (see `highlight` below) and animate in:

- **segment / line / ray**: a stroke "draw-on" from start point to end
  point over ~650ms (`DEFAULT_DURATION_MS` in `src/render/animate.ts`),
  using an SVG `stroke-dasharray`/`stroke-dashoffset` reveal.
- **circle**: a **compass arc-sweep starting at the `through` point**,
  drawn clockwise all the way around back to `through`, over ~800ms
  (`DEFAULT_DURATION_MS + 150`). This is why `through` matters beyond just
  determining the radius — it's the point the animated compass "pivots
  from" visually, matching how you'd actually hold a compass at that
  point. Pick `through` to be the point Euclid's text names as the radius
  ("with centre A, radius AB" → `through: "B"`).
- **point** (including `intersect`/`midpoint`/`extend`/`pointAtDistance`/
  `footOfPerpendicular` results, which are all rendered as `point` shapes
  under the hood): a plain opacity fade-in, ~320ms.
  **polygon** / **angleMark**: a plain opacity fade-in, ~420ms.
- Any **label** on a shape fades in on its own ~420ms tween alongside the
  shape's own animation.

All of the above degrade to an instant jump-to-end-state under
`prefers-reduced-motion` or when the tab is hidden mid-tween — you don't
need to plan for this, it's handled uniformly by the tween runner.

### `set`

```json
{ "targets": ["c1", "c2"], "role": "construction" }
```

Fields: `targets: string[]` (ids of *already-added* shapes — from this step
or any earlier one), `role?`, `color?` (either or both; omitting one
leaves that property unchanged, per `applySet` in
`src/kernel/evaluate.ts`, which does `op.role ?? shape.role` /
`op.color ?? shape.color`). Restyles existing shapes in place; does not
create anything and does not consume an id. Multiple `set` entries can
appear in one step's `set` array.

Effects of `role`:

- `"normal"` — full-strength ink, solid line, default state.
- `"construction"` — thin (stroke width 0.013 vs 0.024 plane units),
  dashed (`0.09 0.07` dash pattern), and faded to 45% opacity
  (`CONSTRUCTION_OPACITY` in `src/render/style.ts`). This is the "grey
  scaffolding" look for sub-constructions that have served their purpose
  but you still want faintly visible for reference (e.g. the compass
  circles in I.1's closing steps).
- `"hidden"` — opacity 0 (fully invisible). Note on framing: the
  proposition frame is the union of every step's *visible* geometry
  (`computePropositionViewBox` in `src/kernel/bounds.ts`), so a shape
  contributes to the frame for the steps in which it is visible and stops
  contributing only for steps where it is hidden — hiding declutters the
  figure but does not shrink the frame retroactively (the scaffolding must
  fit on stage while it is drawn). The shape's id stays fully valid to reference afterward
  (e.g. you can still `intersect` against a hidden circle, or `set` it back
  to `"normal"` later — un-hiding crossfades it back in). This is the
  mechanism I.2 uses to make the two equilateral-triangle circles from its
  "construct triangle DAB" sub-step disappear once point `D` has been
  found and is no longer needed on stage — see section 5.

A restyle transition (any `set` that actually changes `role` or `color`
relative to the shape's previous state) animates as a ~450ms crossfade
(`RESTYLE_DURATION_MS`) of stroke color/width/opacity and dash pattern,
computed by `animateRestyle` in `src/render/animate.ts`; `set`ting a
property to the value it already has is a no-op (no shapes with unchanged
role/color are included in the transition — see `changedRoleIds` in
`src/player/timeline.ts`).

### `highlight`

```json
"highlight": ["AB", "CA", "CB"]
```

Array of existing shape ids (from this step's own `add`, or any earlier
step) to mark as the step's "current" set **in addition to** whatever this
step's `add` introduces. "Current" shapes render in the accent/red color
for the duration this step is the active one (`markCurrentStep` in
`src/player/timeline.ts`, driving the `[data-current]` CSS rule in
`src/player/euclid-player.ts`: `stroke: var(--euclid-accent)`). This is
purely presentational — it does not change any shape's persisted `color`
or `role`, and does not survive past the step (stepping to any other step
recomputes the current set from scratch). Use it for a closing QED-style
step that has nothing new to *construct* but wants to call back to
previously-drawn sides — exactly I.1's `"highlight": ["AB", "CA", "CB"]`
on its final "ABC is equilateral" step, and I.2's `"highlight": ["AL",
"BC"]` on its final "AL is equal to BC" step (which has no `add` at all).

## 5. Visual / aesthetic guidance

The house style, distilled from the two shipped propositions and the style
constants in `src/render/style.ts`, is deliberately austere: thin platonic
lines on paper, ink-black by default, red reserved for one meaning.

- **Red is always "the current step," and an author never sets it
  directly.** `"red"` is a legal value for `color`, but using it on an
  `add`/`set` op would fight the player's own accent-color convention
  (which already renders whatever the active step just did/highlighted in
  red). The shipped propositions never use `color: "red"`. Leave color
  unset (defaults to `"black"`) unless you have a specific reason to tell
  two simultaneous elements apart — e.g. distinguishing two overlapping
  compass circles with `"blue"`/`"yellow"` — and even then, the house
  style shown in I.1/I.2 leaves everything plain ink and lets structure
  (dashing, hiding) carry the distinction instead of hue.
- **`color: "construction"` and `role: "construction"` are different
  knobs that happen to share a name.** `color: "construction"` just tints
  a shape the palette's construction-grey (`#B7B5AC` light /
  `#575653` dark) while leaving it solid-stroked at full opacity.
  `role: "construction"` is what actually produces the dashed,
  thin-stroked, 45%-opacity "scaffolding" look. If you want the classic
  faded-dashed sub-construction appearance, set the **role**, not the
  color, via a `set` op — this is what both shipped files do (`I.1`
  demotes its two compass circles to `role: "construction"` once C is
  found; `I.2` does the same to `cBC` and `cDG`).
- **Hide sub-construction scaffolding once its output exists**, the way
  Byrne's plates omit a cited sub-construction rather than leaving it
  cluttering the page. I.2 is the concrete example: its `find-D` step sets
  `eqc1`/`eqc2` (the equilateral-triangle circles borrowed from I.1) to
  `role: "hidden"` in the very same step that finds `D` — the circles have
  done their job (defining `D`) and the reader doesn't need them cluttering
  the rest of the construction. Prefer `hidden` over `construction` when
  the sub-construction is *fully* spent (nothing later needs to see it,
  only to have used it); prefer `construction` when it's still worth
  showing faintly (e.g. the final proposition's own principal circles,
  which remain relevant context even after the triangle is drawn).
- **Choose `given` coordinates so no two circles that must be visually
  distinct have nearly-equal radii or near-tangencies that read as
  rendering bugs.** This is not a hypothetical: an early draft of this
  project used `BC = 1.70` against `AB = 1.80`, and the two radii were
  close enough that the resulting circles looked tangent (or like a
  rendering error) even though they mathematically intersected in two
  clearly separate points. Pick given lengths with enough visual slack —
  as a rule of thumb, if two circles must intersect, make sure their radii
  and center separation put the intersection points comfortably off the
  line joining the centers, not within a few percent of tangency. If
  `intersect` throws a "circles are tangent" or "too far apart" error at
  all, that is the kernel telling you outright that your chosen coordinates
  are wrong, not a rendering glitch — see the failure-mode list in
  section 3.
- **Keep the whole figure compact.** The auto-computed frame
  (`src/kernel/bounds.ts`) is sized to fit *every visible shape that exists
  in the final step* — including every circle's full radius, not just its
  center — with only a small fixed/proportional padding (`MIN_PADDING =
  0.28` plane units, or 4% of the larger dimension, whichever is bigger).
  A construction with one far-flung point (e.g. a circle radius that's 10x
  everything else) will shrink the rest of the figure to a speck to fit
  that one outlier. The shipped propositions keep their entire final
  figure within roughly a 2–3 unit square (I.1: `given: {A: [-1,0], B:
  [1,0]}`; I.2 similarly compact); aim for the same order of magnitude.
- **Letter points the way the classical figure does.** Euclid's own
  propositions name points in a specific order as the construction
  proceeds (A, B, C, ... then D, E, F, ... for points introduced by the
  construction itself, as opposed to given). I.2 is the model: its given
  points are `A`, `B`, `C`; the point found by intersecting the
  equilateral-triangle circles is lettered `D` (matching Euclid's own
  "Let D be the point..."); the two points where the produced lines meet
  the outer circles are lettered `E`... `G`/`L` following Euclid's actual
  text. Match your source proposition's own lettering rather than
  inventing your own scheme — a reader comparing the animation to a text
  edition of Euclid should see the same letters doing the same things.

## 6. Workflow

1. **Drop `FILE.json` into `public/propositions/`.** No JavaScript rebuild
   is required — proposition JSON is fetched at runtime by `<euclid-player
   src="propositions/FILE.json">` (see `EuclidPlayerElement.load()` in
   `src/player/euclid-player.ts`, which does a plain `fetch(src)` +
   `res.json()`).
2. **View it standalone** at `viewer.html?prop=FILE` (the `prop` query
   param is validated against `^[A-Za-z0-9._-]+$` and mapped straight to
   `propositions/FILE.json` — see `viewer.html`'s inline script), or add a
   `<figure>`/`<euclid-player src="propositions/FILE.json">` block to
   `index.html`'s gallery to view it alongside the others (this does
   require a small HTML edit to `index.html`, unlike dropping the JSON
   file itself).
3. **Validation errors surface directly in the player UI**, not just the
   console: if `validateProposition()` (`src/format/validate.ts`) finds any
   problem, `EuclidPlayerElement` renders a monospace-styled error block in
   place of the stage — `Invalid proposition "propositions/FILE.json":`
   followed by a bulleted list of every validator error message, each one
   naming the offending step id and, where relevant, the bad id/field (see
   `showError()` in `src/player/euclid-player.ts`). Geometry errors that
   only surface at evaluation time (e.g. a real tangency your coordinates
   produce, which the validator can't catch since it doesn't do arithmetic)
   throw a `GeometryError` prefixed with `[stepId]` — check the browser
   console for those, or step through in the player to find exactly which
   step's `add` fails. Fix-and-reload is instant since nothing needs
   rebuilding.
4. **Sanity checks worth doing before calling a proposition done:**
   - Does the **final step's caption read as the theorem statement**
     ("Therefore ABC is an equilateral triangle...", "Wherefore AL is equal
     to BC...")? If the last step is still mid-construction prose, the
     construction is probably missing its QED beat.
   - **Step through backward** from the end (step-back button / left
     arrow) at least once. Backward stepping renders instantly and
     statically (`Timeline.stepBackward` → `renderStatic`, no animation),
     so this is a fast way to visually confirm every intermediate scene
     looks sane — no shape appearing before its inputs exist, no
     scaffolding that should have been hidden still showing, etc.
   - Check that circles which are meant to intersect visibly do so with
     daylight between the crossing points and the tangent case (see
     section 5) — if you can't tell whether two circles cross or are
     tangent just by eye in the rendered figure, nudge the given
     coordinates.
   - Confirm point labels don't collide — `LABEL_OFFSET` is a small fixed
     offset (0.13 plane units) from the shape's anchor, so two points
     placed close together in plane-space will get overlapping labels;
     give them enough separation instead.

## 7. Worked example: bisecting a given angle (Euclid I.9)

*Not present elsewhere in this repo — included here purely as a worked
example, and to prove out the guide's own claims.* It is not wired into
`index.html`'s gallery (adding a proposition to the gallery requires an
HTML edit, which is a separate step from just dropping the JSON file — see
section 6), but it validates, evaluates, and passes the project's
`npx tsc --noEmit` / `npx vitest run` checks as-is; you can open
`viewer.html?prop=I.9` directly to see it.

**The construction** (Elements I.9): given angle BAC, take an arbitrary
point D on AB; cut AE from AC equal to AD; join DE; construct the
equilateral triangle DEF on DE, on the side away from A (Prop. I.1); join
AF. Then AF bisects angle BAC, because triangles ADF and AEF are congruent
by SSS (AD = AE by construction, DF = EF by the equilateral triangle, AF
common) — Prop. I.8.

**Coordinate choice and verification.** Angle BAC is set to 70° so the
bisected halves are a clean 35° each, easy to sanity-check by eye. `A =
(0,0)`, `B = (2.4, 0)` (defines ray AB along angle 0°), `C = (2.4 cos70°,
2.4 sin70°) ≈ (0.8208, 2.2553)` (defines ray AC along angle 70°); `B`/`C`
are only ray-through points, not circle radii, so their equal distance from
`A` is irrelevant to the "no near-tangent circles" rule in section 5. `D =
(1.4, 0)` on AB (arbitrary, chosen well inside the ray so the compass
circles below have comfortable room); `E` is cut from AC at the same
distance `1.4` from `A`, i.e. `pointAtDistance(A, C, 1.4)`. `DE ≈ 1.6060`
becomes the shared radius of the two equilateral-triangle circles centered
at `D` and `E`. Working the circle-circle pick convention by hand (as
prescribed in section 3, with `of: ["cD", "cE"]` so `d = center(E) -
center(D)`): the "left of `d`" solution (`pick: 0`) computes to
`(-0.1999, -0.1400)`, which is *closer* to `A` (distance ≈ 0.244) — that's
the wrong side, the intersection point between the rays. The "right of
`d`" solution (`pick: 1`) computes to `(2.0787, 1.4555)`, distance ≈ 2.538
from `A` — the point on the far side from `A`, which is the `F` Euclid's
construction needs. Computing the angle of `AF` from the x-axis gives
exactly `35.0000...°` — half of 70°, confirming both the arithmetic and the
`pick: 1` choice are correct. Note the frame is sized by the construction
at its *largest visible* moment — here the two equilateral circles on DE,
before they are hidden — not by the compact final figure alone.

```json
{
  "id": "I.9",
  "title": "To bisect a given rectilineal angle.",
  "given": {
    "A": [0, 0],
    "B": [2.4, 0],
    "C": [0.8208483439816051, 2.25526228988618]
  },
  "steps": [
    {
      "id": "given-angle",
      "text": "Let BAC be the given rectilineal angle. It is required to bisect it.",
      "add": [
        { "op": "point", "id": "A", "label": "A" },
        { "op": "point", "id": "B", "label": "B" },
        { "op": "point", "id": "C", "label": "C" },
        { "op": "ray", "id": "AB", "origin": "A", "through": "B" },
        { "op": "ray", "id": "AC", "origin": "A", "through": "C" }
      ]
    },
    {
      "id": "take-D",
      "text": "Take an arbitrary point D on AB.",
      "add": [
        { "op": "point", "id": "D", "at": [1.4, 0], "label": "D" }
      ]
    },
    {
      "id": "cut-AE",
      "text": "Cut off AE from AC equal to AD (Prop. I.3).",
      "add": [
        { "op": "pointAtDistance", "id": "E", "origin": "A", "through": "C", "distance": 1.4, "label": "E" }
      ]
    },
    {
      "id": "join-DE",
      "text": "Join DE.",
      "add": [
        { "op": "segment", "id": "DE", "from": "D", "to": "E" }
      ]
    },
    {
      "id": "equilateral-circles",
      "text": "On DE construct the equilateral triangle DEF (Prop. I.1): with centre D, radius DE, describe a circle; with centre E, radius ED, describe another.",
      "add": [
        { "op": "circle", "id": "cD", "center": "D", "through": "E" },
        { "op": "circle", "id": "cE", "center": "E", "through": "D" }
      ]
    },
    {
      "id": "find-F",
      "text": "Let F be the point where the circles cut one another, on the side remote from A, and join AF.",
      "add": [
        { "op": "intersect", "id": "F", "of": ["cD", "cE"], "pick": 1, "label": "F" },
        { "op": "segment", "id": "AF", "from": "A", "to": "F" }
      ],
      "set": [
        { "targets": ["cD", "cE"], "role": "hidden" }
      ]
    },
    {
      "id": "draw-DF-EF",
      "text": "Join DF and EF.",
      "add": [
        { "op": "segment", "id": "DF", "from": "D", "to": "F" },
        { "op": "segment", "id": "EF", "from": "E", "to": "F" }
      ],
      "set": [
        { "targets": ["DF", "EF"], "role": "construction" }
      ]
    },
    {
      "id": "qed",
      "text": "For AD = AE, DF = EF, and AF is common; therefore the angle DAF equals the angle EAF (Prop. I.8). Wherefore the angle BAC is bisected by the straight line AF, as was required.",
      "highlight": ["AF"]
    }
  ]
}
```

Commentary on the choices this example makes, tying back to earlier
sections:

- `AB`/`AC` are `ray`s so the two arms of the angle read visually as rays,
  not finite segments — but per section 3's rendering caveat, they draw
  only from `origin` to `through`, so `B`/`C` were placed far enough out
  (`2.4` units) to look like they extend past `D`/`E`/`F` without actually
  needing `extend`.
- `D` is a literal `{ "op": "point", "at": [1.4, 0] }` rather than an
  `intersect`/derived point, because Euclid's own text says "take an
  arbitrary point D" — there's no upstream geometric operation that
  produces it, so a literal coordinate is the right op.
- `E` uses `pointAtDistance` (not `extend`) because Euclid's verb here is
  "cut off AE equal to AD," i.e. marking off a length — see the naming
  guidance at the end of the `pointAtDistance` subsection in section 3.
- The two equilateral-triangle circles are set to `role: "hidden"` the
  moment `F` is found, in the same step, exactly mirroring how I.2 hides
  its own equilateral-triangle circles once `D` is found — the circles
  have done their job and would otherwise clutter the rest of the figure.
- `DF`/`EF` are demoted to `role: "construction"` (dashed, faded) rather
  than hidden, since Euclid's SSS congruence argument in the QED step
  explicitly refers to them ("DF = EF") — they're worth keeping faintly
  visible as opposed to fully removed.
- The closing step has no `add` at all, only `highlight: ["AF"]` — the
  bisecting line was already drawn in the `find-F` step; the QED step's
  job is purely to call it out in red while the caption states the
  theorem, exactly the pattern I.2's closing step uses.

## 8. Quick-reference tables

### Operations (`add`)

| op | required fields | produces | notes |
|---|---|---|---|
| `point` | `at?: [x,y]` (omit only to reveal a `given` point by its own id) | point | |
| `segment` | `from`, `to` | finite segment | drawn exactly between endpoints |
| `line` | `a`, `b` | line | infinite for intersection math; **drawn only between `a` and `b`** |
| `ray` | `origin`, `through` | ray | semi-infinite for intersection math; **drawn only between `origin` and `through`** — use `extend` + `segment` to visually produce a line |
| `circle` | `center`, `through` | circle | radius = distance(center, through); `through` is also the compass arc-sweep's animated start point |
| `intersect` | `of: [idA, idB]`, `pick: 0\|1` | point | see pick-order convention, section 3 |
| `midpoint` | `a`, `b` | point | |
| `extend` | `from`, `through`, `distance` | point | absolute distance from `from`, direction `from`→`through` |
| `pointAtDistance` | `origin`, `through`, `distance` | point | absolute distance from `origin`, direction `origin`→`through`; same math as `extend`, different naming fit |
| `footOfPerpendicular` | `from`, `lineA`, `lineB` | point | foot of perpendicular from `from` onto infinite line `lineA`–`lineB` |
| `polygon` | `of: [id, id, ...]` | closed outline | stroke only, no fill |
| `angleMark` | `vertex`, `from`, `to` | decorative arc | always draws the minor arc; not for reflex angles |

Every op also accepts optional `id` (required in practice — see section
2), `label`, `color`.

### Step verbs

| verb | effect | can reference |
|---|---|---|
| `add` | creates new geometry, animates in (draw-on / arc-sweep / fade per shape kind) | earlier steps' ids only |
| `set` | restyles (`role` and/or `color`) existing shapes in place, animates as a crossfade | this step's own `add` ids, or any earlier step's ids |
| `highlight` | marks existing shapes "current" (red) for this step only, no persisted change | this step's own `add` ids, or any earlier step's ids |

### Roles (`ShapeRole`)

| role | stroke | dash | opacity | counted in auto-frame? |
|---|---|---|---|---|
| `normal` | full width (0.024) | solid | 100% | yes |
| `construction` | thin (0.013) | dashed (`0.09 0.07`) | 45% | yes |
| `hidden` | n/a (opacity 0) | n/a | 0% | only for steps where it is still visible (frame = union over all steps) |

### Colors (`ColorName`)

`"black"` (default) · `"red"` (reserved for the player's own current-step
accent — don't author it) · `"yellow"` · `"blue"` · `"construction"` (the
palette's grey — tints a shape but, unlike `role: "construction"`, does
**not** by itself add dashing or reduce opacity/stroke-width).

### Validator rules checklist (`src/format/validate.ts`)

Before trusting a file, confirm it satisfies all of these (the player will
refuse to render and list every violation otherwise):

- [ ] Top-level `id` and `title` are non-empty strings.
- [ ] `view`, if present, has finite numeric `x`/`y`/`width`/`height` with
      `width > 0` and `height > 0`.
- [ ] `given` is an object mapping ids to `[number, number]` tuples of
      finite numbers.
- [ ] `steps` is an array.
- [ ] Every `add` entry has a known `op` (one of the twelve in section 3),
      a non-empty `id`, and (except for `point`) that `id` is not already
      used anywhere earlier.
- [ ] Every id an op references (`from`/`to`/`a`/`b`/`origin`/`through`/
      `center`/`of`/`vertex`/`lineA`/`lineB`/etc., per op kind) resolves to
      an id defined in `given` or an earlier step's `add`.
- [ ] Every `intersect` op's `pick` is exactly `0` or `1`.
- [ ] Every op's `color`, if present, is one of the five known names.
- [ ] Every `set` entry's `targets` array contains only already-known ids,
      and its `role`/`color`, if present, are known values.
- [ ] Every `highlight` entry contains only already-known ids.

Passing validation does **not** guarantee the geometry is realizable — a
mutually-tangent pair of circles, for instance, is perfectly valid JSON but
throws a `GeometryError` at evaluation time (see section 3's failure-mode
list and section 6's workflow guidance).
