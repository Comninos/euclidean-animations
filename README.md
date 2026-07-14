# Euclidean Animations

*This Euclidean animation engine is an early prototype. Everything is subject to change. The translations are taken from Heath (public domain), and may be slightly reworded.*

Animated Euclidean constructions in the browser: step-by-step diagrams that play, pause, and embed via `<iframe>`.

## Quick start

```sh
npm install
npm run dev        # gallery at http://localhost:5173
npm test
npm run build      # static site in dist/
```

- `index.html`: gallery of all propositions
- `viewer.html?prop=I.1`: single proposition (iframe target); add `&theme=dark` for the dark theme

## Embed

```html
<iframe
  src="https://comninos.github.io/euclidean-animations/viewer.html?prop=I.1"
  width="640" height="560"
  style="border: none;"
  loading="lazy"></iframe>
```

## License

Copyright (c) 2026 Daniel Comninos. Released under the [MIT License](LICENSE).

Proposition wording is from T. L. Heath's public-domain translation of Euclid's *Elements*, with light rewording for the animations.
