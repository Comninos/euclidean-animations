// <euclid-player src="propositions/I.1.json" autoplay></euclid-player>
//
// Custom element, shadow DOM. Layout: SVG stage on top, caption text below,
// control bar (restart / step back / play-pause / step forward / step
// dots). Keyboard: space toggles play, left/right arrows step. Fixed aspect
// ratio derived from the proposition's `view` so iframes size predictably.
// Validation/load errors are rendered into the component's own UI.

import { validateProposition } from '../format/validate';
import type { Proposition } from '../format/schema';
import { Timeline } from './timeline';
import { stateAt } from '../kernel/evaluate';
import { computeViewBox } from '../kernel/bounds';
import { createStageSvg } from '../render/svg';
import {
  DEFAULT_THEME,
  LABEL_FONT_FAMILY,
  STROKE_WIDTH_MINIMAL,
  THEMES,
  themeCssDeclarations,
} from '../render/style';

/** CSS for every registered theme: palette/accent variables, plus the
 * behavioral rules for `accentCurrentStep` (current-step geometry takes
 * the accent color) and `minimal` (hairline strokes, no fills, smaller
 * points, calm entrances via --euclid-anim). CSS rules outrank SVG
 * presentation attributes, which is what lets a theme restyle
 * already-rendered shapes without a re-render. */
function themeBlocks(): string {
  return Object.entries(THEMES)
    .map(([name, theme]) => {
      const host = `:host([theme="${name}"])`;
      const stage = `${host} svg.euclid-stage`;
      const rules: string[] = [
        `${host} {\n    ${themeCssDeclarations(theme)}${theme.minimal ? '\n    --euclid-anim: minimal;' : ''}\n  }`,
      ];
      if (theme.minimal) {
        rules.push(
          `${stage} [data-role="normal"] { stroke-width: ${STROKE_WIDTH_MINIMAL.normal}; }`,
          `${stage} [data-role="construction"] { stroke-width: ${STROKE_WIDTH_MINIMAL.construction}; }`,
          `${stage} [data-kind="polygon"], ${stage} [data-kind="sector"] { fill: none; }`,
          `${stage} circle[data-kind="point"] { r: ${STROKE_WIDTH_MINIMAL.pointRadius}px; }`
        );
      }
      if (theme.accentCurrentStep) {
        rules.push(
          `${stage} [data-current]:not(text) { stroke: var(--euclid-accent); }`,
          `${stage} [data-current][data-kind="point"] { fill: var(--euclid-accent); }`,
          `${stage} text[data-current] { fill: var(--euclid-accent); }`
        );
      }
      return rules.join('\n  ');
    })
    .join('\n  ');
}

const TEMPLATE = `
<style>
  :host {
    ${themeCssDeclarations(DEFAULT_THEME)}
    /* alpha tones derived from the ink color, for chrome (borders etc.) */
    --euclid-line: color-mix(in srgb, var(--euclid-black) 14%, transparent);
    --euclid-line-strong: color-mix(in srgb, var(--euclid-black) 38%, transparent);
    --euclid-hover: color-mix(in srgb, var(--euclid-black) 8%, transparent);
    display: block;
    box-sizing: border-box;
    font-family: ${LABEL_FONT_FAMILY};
    background: var(--euclid-background);
    color: var(--euclid-black);
    border: 1px solid var(--euclid-line);
    border-radius: 4px;
    overflow: hidden;
    --euclid-aspect: 1.375; /* width / height, replaced once the proposition loads */
  }
  ${themeBlocks()}
  * { box-sizing: border-box; }
  .stage-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: var(--euclid-aspect);
    background: var(--euclid-background);
  }
  /* fill mode (<euclid-player fill>): fit the host's given height instead
     of deriving height from width via aspect-ratio. Used by full-bleed
     iframe embeds, where aspect-driven sizing can push the caption and
     controls below the iframe edge and clip them. */
  :host([fill]) {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  :host([fill]) .stage-wrap {
    flex: 1;
    min-height: 0;
    aspect-ratio: auto;
  }
  svg.euclid-stage {
    width: 100%;
    height: 100%;
    display: block;
  }
  rect.euclid-background {
    fill: var(--euclid-background);
  }
  text.euclid-label {
    user-select: none;
    pointer-events: none;
  }
  .caption {
    min-height: 2.4em;
    padding: 0.6em 1em;
    font-style: italic;
    font-size: 0.95rem;
    line-height: 1.35;
    border-top: 1px solid var(--euclid-line);
    color: var(--euclid-black);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.5em 0.8em;
    border-top: 1px solid var(--euclid-line);
    font-family: system-ui, sans-serif;
  }
  button.ctrl {
    appearance: none;
    border: 1px solid var(--euclid-line-strong);
    background: var(--euclid-background);
    color: var(--euclid-black);
    border-radius: 4px;
    width: 2.1em;
    height: 2.1em;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  button.ctrl:hover:not(:disabled) {
    background: var(--euclid-hover);
  }
  button.ctrl:disabled {
    opacity: 0.35;
    cursor: default;
  }
  button.ctrl:focus-visible {
    outline: 2px solid var(--euclid-blue);
    outline-offset: 1px;
  }
  .dots {
    display: flex;
    align-items: center;
    gap: 0.35em;
    margin-left: 0.4em;
    flex-wrap: wrap;
  }
  .dot {
    width: 0.6em;
    height: 0.6em;
    border-radius: 50%;
    border: 1px solid var(--euclid-line-strong);
    background: transparent;
    padding: 0;
    cursor: pointer;
  }
  .dot[aria-current="true"] {
    background: var(--euclid-accent);
    border-color: var(--euclid-accent);
  }
  .error {
    padding: 1em;
    font-family: system-ui, sans-serif;
    font-style: normal;
    color: var(--euclid-accent);
    white-space: pre-wrap;
  }
  .title {
    padding: 0.7em 1em 0;
    font-weight: bold;
    font-style: normal;
    font-size: 1rem;
  }
</style>
<div class="title" part="title" hidden></div>
<div class="stage-wrap" part="stage-wrap"></div>
<div class="caption" part="caption"></div>
<div class="controls" part="controls">
  <button class="ctrl" data-action="restart" title="Restart" aria-label="Restart">&#9198;</button>
  <button class="ctrl" data-action="back" title="Step back" aria-label="Step back">&#8249;</button>
  <button class="ctrl" data-action="play" title="Play/Pause" aria-label="Play or pause">&#9654;</button>
  <button class="ctrl" data-action="forward" title="Step forward" aria-label="Step forward">&#8250;</button>
  <div class="dots" part="dots"></div>
</div>
`;

export class EuclidPlayerElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['src', 'autoplay'];
  }

  private shadow: ShadowRoot;
  private stageWrap: HTMLDivElement;
  private captionEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private dotsEl: HTMLDivElement;
  private restartBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private playBtn: HTMLButtonElement;
  private forwardBtn: HTMLButtonElement;

  private timeline: Timeline | null = null;
  private prop: Proposition | null = null;
  private loadToken = 0;
  private reducedMotionQuery: MediaQueryList | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = TEMPLATE;

    this.stageWrap = this.shadow.querySelector('.stage-wrap') as HTMLDivElement;
    this.captionEl = this.shadow.querySelector('.caption') as HTMLDivElement;
    this.titleEl = this.shadow.querySelector('.title') as HTMLDivElement;
    this.dotsEl = this.shadow.querySelector('.dots') as HTMLDivElement;
    this.restartBtn = this.shadow.querySelector('[data-action="restart"]') as HTMLButtonElement;
    this.backBtn = this.shadow.querySelector('[data-action="back"]') as HTMLButtonElement;
    this.playBtn = this.shadow.querySelector('[data-action="play"]') as HTMLButtonElement;
    this.forwardBtn = this.shadow.querySelector('[data-action="forward"]') as HTMLButtonElement;

    this.restartBtn.addEventListener('click', () => this.timeline?.restart());
    this.backBtn.addEventListener('click', () => {
      this.timeline?.stepBackward();
      this.refreshControlAvailability();
    });
    this.forwardBtn.addEventListener('click', () => {
      this.timeline?.pause();
      void this.timeline?.stepForward();
      // stepForward() only reports via onStepChange once its animation
      // commits; refresh immediately so back/forward disabled-state (which
      // depends on the timeline's in-flight-aware isAtStart/isAtEnd)
      // reflects reality for the whole duration of the animation, not just
      // its end.
      this.refreshControlAvailability();
    });
    this.playBtn.addEventListener('click', () => this.timeline?.togglePlay());

    this.tabIndex = this.hasAttribute('tabindex') ? Number(this.getAttribute('tabindex')) : 0;
    this.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  connectedCallback(): void {
    if (!this.timeline && !this.prop) {
      void this.load();
    }
    if (typeof window.matchMedia === 'function') {
      this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    }
  }

  disconnectedCallback(): void {
    this.reducedMotionQuery = null;
  }

  attributeChangedCallback(name: string): void {
    if (name === 'src' && this.isConnected) {
      void this.load();
    }
  }

  get src(): string | null {
    return this.getAttribute('src');
  }

  set src(value: string | null) {
    if (value === null) this.removeAttribute('src');
    else this.setAttribute('src', value);
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.timeline) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.timeline.togglePlay();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      this.timeline.pause();
      void this.timeline.stepForward();
      this.refreshControlAvailability();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      this.timeline.pause();
      this.timeline.stepBackward();
      this.refreshControlAvailability();
    }
  }

  /** Sync back/forward disabled-state to the timeline's current
   * (in-flight-aware) isAtStart/isAtEnd immediately, without waiting for
   * the next onStepChange commit event. */
  private refreshControlAvailability(): void {
    if (!this.timeline) return;
    this.backBtn.disabled = this.timeline.isAtStart;
    this.forwardBtn.disabled = this.timeline.isAtEnd;
  }

  private showError(messages: readonly string[]): void {
    this.stageWrap.innerHTML = `<div class="error">${escapeHtml(messages.join('\n'))}</div>`;
    this.captionEl.textContent = '';
    this.dotsEl.innerHTML = '';
    this.setControlsEnabled(false);
  }

  private setControlsEnabled(enabled: boolean): void {
    for (const btn of [this.restartBtn, this.backBtn, this.playBtn, this.forwardBtn]) {
      btn.disabled = !enabled;
    }
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    const src = this.src;
    if (!src) {
      this.showError(['<euclid-player>: missing "src" attribute']);
      return;
    }

    let json: unknown;
    try {
      const res = await fetch(src);
      if (token !== this.loadToken) return;
      if (!res.ok) {
        this.showError([`Failed to load "${src}": HTTP ${res.status} ${res.statusText}`]);
        return;
      }
      json = await res.json();
      if (token !== this.loadToken) return;
    } catch (err) {
      if (token !== this.loadToken) return;
      this.showError([`Failed to fetch "${src}": ${err instanceof Error ? err.message : String(err)}`]);
      return;
    }

    const result = validateProposition(json);
    if (!result.valid) {
      this.showError([`Invalid proposition "${src}":`, ...result.errors.map((e) => `  - ${e}`)]);
      return;
    }

    this.prop = json as Proposition;
    this.mount(this.prop);
  }

  private mount(prop: Proposition): void {
    this.stageWrap.innerHTML = '';
    // Frame the stage on the *final* scene's geometry unless the author
    // pinned an explicit view, so no step ever draws outside the frame.
    const view = prop.view ?? computeViewBox(stateAt(prop, prop.steps.length));
    const svg = createStageSvg(view);
    this.stageWrap.appendChild(svg);

    const aspect = view.width / view.height;
    this.style.setProperty('--euclid-aspect', String(aspect));

    if (prop.title) {
      this.titleEl.textContent = prop.title;
      this.titleEl.hidden = false;
    }

    this.buildDots(prop.steps.length);
    this.setControlsEnabled(true);

    this.timeline = new Timeline(prop, svg, {
      onStepChange: (step, total) => this.onStepChange(step, total),
      onPlayStateChange: (state) => this.onPlayStateChange(state),
    });

    this.onStepChange(0, prop.steps.length);
    this.onPlayStateChange('paused');

    if (this.hasAttribute('autoplay')) {
      void this.timeline.play();
    }
  }

  private buildDots(totalSteps: number): void {
    this.dotsEl.innerHTML = '';
    for (let k = 0; k <= totalSteps; k++) {
      const dot = document.createElement('button');
      dot.className = 'dot';
      dot.type = 'button';
      dot.setAttribute('aria-label', k === 0 ? 'Go to start' : `Go to step ${k}`);
      dot.addEventListener('click', () => {
        this.timeline?.pause();
        this.timeline?.goTo(k);
      });
      this.dotsEl.appendChild(dot);
    }
  }

  private onStepChange(step: number, total: number): void {
    this.updateDots(step);
    // Use the timeline's isAtStart/isAtEnd (which account for an in-flight
    // forward transition via effectiveStep) rather than the raw settled
    // `step` param — otherwise the back button stays disabled for the
    // entire duration of the very first step's animation, since
    // onStepChange only fires once that animation *commits*.
    this.backBtn.disabled = this.timeline?.isAtStart ?? step <= 0;
    this.forwardBtn.disabled = this.timeline?.isAtEnd ?? step >= total;
    const stepDef = this.prop?.steps[step - 1];
    // Caption reflects the most recently completed step's text (or a
    // neutral prompt at step 0, before anything has been constructed).
    if (step === 0) {
      this.captionEl.textContent = this.prop?.title ?? '';
    } else {
      this.captionEl.textContent = stepDef?.text ?? '';
    }
    this.dispatchEvent(new CustomEvent('euclid-step', { detail: { step, total }, bubbles: true, composed: true }));
  }

  private onPlayStateChange(state: 'paused' | 'playing'): void {
    this.playBtn.innerHTML = state === 'playing' ? '&#10074;&#10074;' : '&#9654;';
    this.playBtn.setAttribute('aria-label', state === 'playing' ? 'Pause' : 'Play');
    this.playBtn.disabled = state === 'paused' && (this.timeline?.isAtEnd ?? false);
  }

  private updateDots(step: number): void {
    const dots = this.dotsEl.querySelectorAll('.dot');
    dots.forEach((dot, idx) => {
      if (idx === step) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function registerEuclidPlayer(tagName = 'euclid-player'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, EuclidPlayerElement);
  }
}
