# Euclidean Animations

Animated Euclidean constructions — each proposition rendered as a step-by-step geometric construction, thin platonic lines with the current step picked out in red, that plays in the browser and can be embedded anywhere with an `<iframe>`.

- **Geometry kernel** — exact construction math (intersections, distances, extensions), no rendering concerns.
- **Declarative propositions** — each proposition is a single JSON file describing construction steps; no code required to add one.
- **SVG renderer** — crisp, scalable hairline graphics with compass-sweep and draw-on animations.
- **`<euclid-player>` web component** — play, pause, step forward/backward, restart. Stepping is *logical*: one step = one beat of the construction, not a unit of time.

## Quick start

```sh
npm install
npm run dev        # gallery at http://localhost:5173
npm test           # geometry kernel tests
npm run build      # static site in dist/
```

- `index.html` — gallery of all propositions.
- `viewer.html?prop=I.1` — a single proposition, full-bleed. This is the iframe target.

## Embedding (Obsidian Publish or any web page)

The site deploys to GitHub Pages on every push to `main` (see `.github/workflows/deploy.yml`). Embed a proposition with:

```html
<iframe
  src="https://comninos.github.io/euclidean-animations/viewer.html?prop=I.1"
  width="640" height="560"
  style="border: none;"
  loading="lazy"></iframe>
```

In Obsidian, put the `<iframe>` tag directly in a note; Obsidian Publish renders it as-is.

### Theming embeds

There are exactly two themes, both Flexoki-based: the default (no `theme` attribute) is light-on-paper, and `theme="dark"` is light ink on a near-black ground. Both are declared as plain CSS custom properties in `src/render/style.ts` / `src/player/euclid-player.ts` (`--euclid-*` on `:host`), which is what lets a theme switch restyle already-rendered shapes instantly without a re-render.

Select a theme per embed:

- `viewer.html?prop=I.1&theme=dark` — the only non-default theme name.
- `...&bg=%23262626` — override the background with an exact color (URL-encoded hex) so the embed blends into your page.

To follow **Obsidian's own light/dark toggle live** (which is independent of the OS/browser preference), add this to your Obsidian Publish `publish.js`. It answers each embed when it loads and re-broadcasts whenever the reader flips the theme:

```js
(function () {
  var FRAMES = 'iframe[src*="euclidean-animations/viewer.html"]';
  function theme() {
    return document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  }
  function send(frame) {
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'euclid-theme', theme: theme() }, '*');
    }
  }
  function broadcast() {
    document.querySelectorAll(FRAMES).forEach(send);
  }
  // Each viewer announces itself when loaded; answer with the current theme.
  // Viewers also report their ideal height (the geometry at full width
  // plus the caption/controls chrome) — size the iframe to match so the
  // drawing is as large as the width allows, for any proposition.
  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.type === 'euclid-ready') broadcast();
    if (e.data.type === 'euclid-size' && typeof e.data.height === 'number') {
      var h = Math.max(200, Math.min(2000, Math.round(e.data.height)));
      document.querySelectorAll(FRAMES).forEach(function (frame) {
        if (frame.contentWindow === e.source) frame.style.height = h + 'px';
      });
    }
  });
  // Re-broadcast when the reader toggles Obsidian's theme.
  new MutationObserver(broadcast).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  // Publish loads this script late — any iframe that announced itself
  // before we attached the listener above needs this initial broadcast.
  broadcast();
})();
```

The message format is `{ type: 'euclid-theme', theme: 'dark' | 'light', bg?: '#hex' }` — `bg` optionally overrides the background color to match a custom theme exactly. In the other direction, each viewer posts `{ type: 'euclid-ready' }` when loaded and `{ type: 'euclid-size', height }` whenever its ideal height changes (on load and on resize), which the snippet above uses to auto-size the iframe. The `height` attribute on the `<iframe>` then only matters as the pre-JS fallback.

### Full-bleed embeds

To let an embed break out of the note's text column and use the full page width (the same pattern used for other full-bleed widgets), add this to your Obsidian Publish `publish.css`:

```css
iframe[src*="euclidean-animations"] {
  width: calc(100% + 96px) !important;
  margin-left: -48px;
  display: block;
  border: none;
}

@media (max-width: 750px) {
  iframe[src*="euclidean-animations"] {
    width: 100vw !important;
    margin-left: calc(50% - 50vw);
    border-radius: 0;
  }
}
```

With the `euclid-size` listener from the publish.js snippet above, the iframe's height follows its width automatically — full-bleed embeds get the geometry at the full available width with no letterboxing, for any proposition's aspect ratio. Without that script, size manually: the wider the iframe gets relative to its `height`, the more the fixed-height `fill` player letterboxes horizontally, so pair full-bleed width with a proportionally generous `height` attribute (a roughly square proposition like I.2 wants `height ≈ width + 170`).

## Authoring a proposition

See [`docs/AUTHORING.md`](docs/AUTHORING.md) for the complete format reference (every op, every failure mode, a worked example) — the summary below covers just the basics.

Add a file under `public/propositions/` (e.g. `I.5.json`). No rebuild of the JavaScript is needed — proposition JSON is fetched at runtime.

```jsonc
{
  "id": "I.1",
  "title": "On a given finite straight line to construct an equilateral triangle.",
  "given": { "A": [-1, 0], "B": [1, 0] },                          // fixed starting points
  "steps": [
    { "text": "Caption shown while this step plays.",
      "add": [ /* elements constructed in this step */ ],
      "set": [ /* restyle earlier elements, e.g. demote to construction lines */ ],
      "highlight": [ /* ids to render in red for this step */ ]
    }
  ]
}
```

Each entry in `steps` is one *logical beat* — one click of the step-forward button. Elements in `add` reference earlier elements by id.

The frame is computed automatically from the union of **every step's visible geometry** (plus padding), so nothing is ever clipped — including scaffolding that a later step hides. Add an optional top-level `"view": { "x", "y", "width", "height" }` (world-space, y-up) only when you want to crop deliberately.

The `<euclid-player>` element sizes itself from its width by default (gallery-style). Add the `fill` attribute — as `viewer.html` does — to make it fit a fixed-height container such as an iframe, so the caption and controls always stay visible.

### Operations

| op | fields | result |
|----|--------|--------|
| `point` | `at: [x, y]` or reference | a labeled point |
| `segment` | `from`, `to` | segment between two points |
| `line` | `a`, `b` | line through two points (infinite for intersections, drawn a–b) |
| `ray` | `origin`, `through` | ray (semi-infinite for intersections, drawn origin–through) |
| `circle` | `center`, `through` | compass circle |
| `intersect` | `of: [a, b]`, `pick` | intersection point of two elements |
| `extend` | `from`, `through`, `distance` | point at a distance along a direction (for producing lines) |
| `polygon` | `of: [p1, p2, ...]` | outline (stroke-only) polygon |

### The `pick` convention

Circle–circle and line–circle intersections have two solutions. They are ordered deterministically: for circle–circle, `pick: 0` is the intersection on the **left** of the direction vector from the first circle's center to the second's (counter-clockwise side); `pick: 1` is the right. For line–circle, solutions are ordered along the line's direction. This is locked in by unit tests in `tests/ops.test.ts`.

### Styling

The visual style is monochrome by default: thin platonic lines, no fills, with the current step's geometry always rendered in red (the accent color) via the player chrome — not something an author sets. Per-element color is an optional deviation an author can reach for (e.g. to distinguish two compass circles): `color: "red" | "yellow" | "blue" | "black"` on an `add` op, named and mapped through the theme palette in `src/render/style.ts`. It defaults to `black` (ink).

Setting `role: "construction"` on an element (via `set`) demotes it to a thin, dashed, faded line — used to de-emphasize scaffolding once the result is drawn. Setting `role: "hidden"` fades it out entirely, the way Byrne's plates simply omit a cited sub-construction — e.g. I.2 hides the equilateral-triangle circles once D exists. Hidden elements stay referenceable and can be un-hidden by a later `set`. Note that hiding declutters but does not shrink the frame: the frame always covers the geometry at its largest visible extent, so big scaffolding still costs figure size even if hidden later.

A step's `highlight: [ids...]` marks existing elements (from this step or any earlier one) as "current" for that step, so they render in red alongside whatever the step adds — e.g. calling out the two sides just proved equal in a QED step.

## Architecture

```
src/kernel/    pure geometry math + step evaluator (no DOM)
src/format/    JSON schema types + validation
src/render/    minimal palette/styles, static SVG rendering, rAF tween animations
src/player/    step-indexed timeline + <euclid-player> custom element
```

The timeline is **step-indexed, not clock-indexed**: the scene at step *k* is a pure function of the steps, so stepping backward or seeking renders instantly and can never desync from a clock.
