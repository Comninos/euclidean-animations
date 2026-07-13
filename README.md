# Euclidean Animations

Animated Euclidean constructions in the spirit of [Oliver Byrne's 1847 edition of Euclid's *Elements*](https://www.c82.net/euclid/) — each proposition rendered as a step-by-step, colored geometric construction that plays in the browser and can be embedded anywhere with an `<iframe>`.

- **Geometry kernel** — exact construction math (intersections, distances, extensions), no rendering concerns.
- **Declarative propositions** — each proposition is a single JSON file describing construction steps; no code required to add one.
- **SVG renderer** — crisp, scalable Byrne-style graphics with compass-sweep and draw-on animations.
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

Themes live in one registry in `src/render/style.ts` (`THEMES`) — add an entry there and it's immediately usable everywhere. Built-in:

| name | look |
|------|------|
| *(default)* | Byrne light: colored construction on cream |
| `dark` | Byrne dark: same hues, brightened, on a dark ground |
| `mono` | Minimal: hairline ink lines on paper, no fills, **current step in red** |
| `mono-dark` | The same, light ink on near-black |

A theme is a palette plus optional behaviors: `accentCurrentStep` renders the most recent step's geometry in the accent color, and `minimal` switches to hairline strokes, unfilled polygons, smaller points, and calm fade entrances (no pops or pulses; lines still draw on).

Select a theme per embed:

- `viewer.html?prop=I.1&theme=mono-dark` — any registered theme name.
- `...&bg=%23262626` — override the background with an exact color (URL-encoded hex) so the embed blends into your page.

To follow **Obsidian's own light/dark toggle live** (which is independent of the OS/browser preference), add this to your Obsidian Publish `publish.js`. It answers each embed when it loads and re-broadcasts whenever the reader flips the theme:

```js
(function () {
  var FRAMES = 'iframe[src*="euclidean-animations/viewer.html"]';
  var LIGHT_THEME = 'light'; // e.g. 'mono' for the minimal look
  var DARK_THEME = 'dark';   // e.g. 'mono-dark'
  function theme() {
    return document.body.classList.contains('theme-dark') ? DARK_THEME : LIGHT_THEME;
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
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'euclid-ready') broadcast();
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

The message format is `{ type: 'euclid-theme', theme: 'dark' | 'light', bg?: '#hex' }` — `bg` optionally overrides the background color to match a custom theme exactly.

## Authoring a proposition

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
      "highlight": [ /* ids to pulse */ ]
    }
  ]
}
```

Each entry in `steps` is one *logical beat* — one click of the step-forward button. Elements in `add` reference earlier elements by id.

The frame is computed automatically from the **final** step's geometry (plus padding), so every circle and point fits at every step. Add an optional top-level `"view": { "x", "y", "width", "height" }` (world-space, y-up) only when you want to crop deliberately.

The `<euclid-player>` element sizes itself from its width by default (gallery-style). Add the `fill` attribute — as `viewer.html` does — to make it fit a fixed-height container such as an iframe, so the caption and controls always stay visible.

### Operations

| op | fields | result |
|----|--------|--------|
| `point` | `at: [x, y]` or reference | a labeled point |
| `segment` | `from`, `to` | segment between two points |
| `line` / `ray` | `from`, `to` | infinite line / ray through two points |
| `circle` | `center`, `through` | compass circle |
| `intersect` | `of: [a, b]`, `pick` | intersection point of two elements |
| `polygon` | `of: [p1, p2, ...]` | filled region |

### The `pick` convention

Circle–circle and line–circle intersections have two solutions. They are ordered deterministically: for circle–circle, `pick: 0` is the intersection on the **left** of the direction vector from the first circle's center to the second's (counter-clockwise side); `pick: 1` is the right. For line–circle, solutions are ordered along the line's direction. This is locked in by unit tests in `tests/ops.test.ts`.

### Styling

Colors are named, mapped through the Byrne palette in `src/render/style.ts`: `red`, `yellow`, `blue`, `black`. Setting `role: "construction"` on an element (via `set`) demotes it to a thin, dashed, faded line — used to de-emphasize scaffolding once the result is drawn.

## Architecture

```
src/kernel/    pure geometry math + step evaluator (no DOM)
src/format/    JSON schema types + validation
src/render/    Byrne styles, static SVG rendering, rAF tween animations
src/player/    step-indexed timeline + <euclid-player> custom element
```

The timeline is **step-indexed, not clock-indexed**: the scene at step *k* is a pure function of the steps, so stepping backward or seeking renders instantly and can never desync from a clock.
