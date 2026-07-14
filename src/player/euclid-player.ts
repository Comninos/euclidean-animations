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
import { computePropositionViewBox } from '../kernel/bounds';
import { createStageSvg } from '../render/svg';
import { DARK_PALETTE, LABEL_FONT_FAMILY, LIGHT_PALETTE, paletteCssDeclarations } from '../render/style';

/** Inline stroke icons on a shared 24px grid, so every control glyph has
 * identical visual weight and height (the Unicode media glyphs the player
 * previously used render at wildly different sizes per font). They draw
 * with currentColor, so the grey/accent-hover CSS applies unchanged. */
function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const ICONS = {
  restart: icon('<path d="M7 5v14"/><path d="M17 5l-8 7 8 7"/>'),
  back: icon('<path d="M14 6l-6 6 6 6"/>'),
  forward: icon('<path d="M10 6l6 6-6 6"/>'),
  play: icon('<path d="M8 5.5l11 6.5-11 6.5z"/>'),
  pause: icon('<path d="M9 5.5v13"/><path d="M15 5.5v13"/>'),
} as const;

const TEMPLATE = `
<style>
  :host {
    ${paletteCssDeclarations(LIGHT_PALETTE)}
    /* alpha tone derived from the ink color, for the host's hairline border
       (gallery mode only — fill mode drops it, see :host([fill])). */
    --euclid-line: color-mix(in srgb, var(--euclid-black) 14%, transparent);
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
  :host([theme="dark"]) {
    ${paletteCssDeclarations(DARK_PALETTE)}
  }
  /* The current step's geometry (data-current, set by the timeline) always
     renders in the accent color, so the newest construction stands out. */
  svg.euclid-stage [data-current]:not(text) { stroke: var(--euclid-accent); }
  svg.euclid-stage [data-current][data-kind="point"] { fill: var(--euclid-accent); }
  svg.euclid-stage text[data-current] { fill: var(--euclid-accent); }
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
    /* Full-bleed iframe embeds: no border chrome eating into the width. */
    border: none;
    border-radius: 0;
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
    /* Height is set inline (in JS) to the tallest caption/title across the
       whole proposition, measured at the current width, so the stage above
       never jumps when a step's text wraps to a different line count. See
       measureCaptionHeight()/syncCaptionHeight() in EuclidPlayerElement. */
    /* --euclid-text-inset lets an embedding page align the player's text
       with its own text column (see the inset field in the publish.js
       snippet in the README); defaults to the player's own 1em gutter. */
    padding: 0.6em var(--euclid-text-inset, 1em);
    font-style: italic;
    font-size: 0.95rem;
    line-height: 1.35;
    color: var(--euclid-black);
    box-sizing: border-box;
  }
  .controls {
    /* Three-column grid: transport buttons left, dots dead-center of the
       whole bar (the empty 1fr third column balances the first). */
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0.4em var(--euclid-text-inset, 0.8em) 0.6em;
    font-family: system-ui, sans-serif;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 0;
    justify-self: start;
  }
  button.ctrl {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--euclid-control);
    width: 32px;
    height: 32px;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 120ms ease;
  }
  button.ctrl:hover:not(:disabled) {
    color: var(--euclid-accent);
  }
  button.ctrl:disabled {
    opacity: 0.35;
    cursor: default;
  }
  button.ctrl:disabled:hover {
    color: var(--euclid-control);
  }
  button.ctrl:focus-visible {
    color: var(--euclid-accent);
    outline: 1px solid var(--euclid-control);
    outline-offset: 1px;
    border-radius: 4px;
  }
  .dots {
    display: flex;
    align-items: center;
    gap: 0.35em;
    flex-wrap: wrap;
    justify-content: center;
  }
  .dot {
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    border: 1px solid var(--euclid-control);
    background: transparent;
    padding: 0;
    cursor: pointer;
  }
  .dot[aria-current="true"] {
    background: var(--euclid-accent);
    border-color: var(--euclid-accent);
  }
  .dot:focus-visible {
    outline: none;
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
    padding: 0.7em var(--euclid-text-inset, 1em) 0;
    font-weight: bold;
    font-style: normal;
    font-size: 1rem;
    text-align: left;
  }
</style>
<div class="stage-wrap" part="stage-wrap"></div>
<div class="title" part="title" hidden></div>
<div class="caption" part="caption"></div>
<div class="controls" part="controls">
  <div class="transport" part="transport">
    <button class="ctrl" data-action="restart" title="Restart" aria-label="Restart">${ICONS.restart}</button>
    <button class="ctrl" data-action="back" title="Step back" aria-label="Step back">${ICONS.back}</button>
    <button class="ctrl" data-action="play" title="Play/Pause" aria-label="Play or pause">${ICONS.play}</button>
    <button class="ctrl" data-action="forward" title="Step forward" aria-label="Step forward">${ICONS.forward}</button>
  </div>
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
  private resizeObserver: ResizeObserver | null = null;
  /** Offscreen clone of .caption used only to measure text height at the
   * current width; see measureMaxCaptionHeight()/syncCaptionHeight(). */
  private captionMeasurer: HTMLDivElement | null = null;

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
    if (typeof ResizeObserver !== 'undefined' && !this.resizeObserver) {
      // The caption's reserved height depends on its rendered width (how
      // many lines each step's text wraps to), so any host resize can
      // invalidate the previously measured max and must re-measure.
      this.resizeObserver = new ResizeObserver(() => this.syncCaptionHeight());
      this.resizeObserver.observe(this);
    }
  }

  disconnectedCallback(): void {
    this.reducedMotionQuery = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
    // Frame the stage on the union of every step's visible geometry unless
    // the author pinned an explicit view, so no step ever draws outside the
    // frame — including scaffolding that a later step hides.
    const view = prop.view ?? computePropositionViewBox(prop);
    const svg = createStageSvg(view);
    this.stageWrap.appendChild(svg);

    // The stage box is never taller than 4 units per 5 of width (5:4):
    // tall geometry letterboxes inside the capped box instead of
    // stretching the player (and, via the euclid-size report, the
    // embedding iframe) vertically.
    const aspect = Math.max(5 / 4, view.width / view.height);
    this.style.setProperty('--euclid-aspect', String(aspect));

    if (prop.title) {
      this.titleEl.textContent = prop.title;
      this.titleEl.hidden = false;
    }

    this.buildDots(prop.steps.length);
    this.setControlsEnabled(true);

    this.timeline = new Timeline(prop, svg, {
      onStepStart: (step) => this.showStep(step),
      onStepChange: (step, total) => this.onStepChange(step, total),
      onPlayStateChange: (state) => this.onPlayStateChange(state),
    });

    this.onStepChange(0, prop.steps.length);
    this.onPlayStateChange('paused');
    this.syncCaptionHeight();

    if (this.hasAttribute('autoplay')) {
      void this.timeline.play();
    } else {
      // Show the completed figure on load — a blank stage tells the reader
      // nothing. Pressing play replays the construction from the start.
      this.timeline.goTo(prop.steps.length);
    }
  }

  /** Reserve stable space in .caption for the tallest caption text across
   * every step of the current proposition, measured at the caption's
   * *current* rendered width. This prevents the stage above from jumping
   * when stepping between captions that wrap to different numbers of
   * lines — the caption block is sized once up front instead of
   * growing/shrinking per step. Called after mount() and on every host
   * resize (the wrap point depends on width). */
  private syncCaptionHeight(): void {
    if (!this.prop) return;
    const texts: string[] = [];
    for (const step of this.prop.steps) texts.push(step.text ?? '');
    const max = this.measureMaxCaptionHeight(texts);
    this.captionEl.style.height = max > 0 ? `${max}px` : '';
  }

  /** Render each candidate string into an offscreen clone of .caption
   * (same computed styles/width, absolutely positioned out of flow so it
   * never affects layout or paints), and return the tallest resulting
   * scrollHeight in px. Using a real clone of the element — rather than
   * guessing from font metrics — keeps this correct under font
   * loading/zoom/user font-size overrides without duplicating the
   * caption's CSS. */
  private measureMaxCaptionHeight(texts: readonly string[]): number {
    const measurer = this.getCaptionMeasurer();
    // Match the live caption's content-box width so text wraps identically.
    const liveWidth = this.captionEl.getBoundingClientRect().width;
    if (liveWidth > 0) measurer.style.width = `${liveWidth}px`;
    let max = 0;
    for (const text of texts) {
      measurer.textContent = text;
      max = Math.max(max, measurer.scrollHeight);
    }
    return max;
  }

  /** Lazily create the hidden .caption clone used for measurement, inside
   * the shadow root so it inherits identical styles (font, padding,
   * line-height) via the same <style> block. */
  private getCaptionMeasurer(): HTMLDivElement {
    if (this.captionMeasurer) return this.captionMeasurer;
    const measurer = document.createElement('div');
    measurer.className = 'caption';
    measurer.setAttribute('aria-hidden', 'true');
    measurer.style.position = 'absolute';
    measurer.style.visibility = 'hidden';
    measurer.style.height = 'auto';
    measurer.style.pointerEvents = 'none';
    measurer.style.top = '0';
    measurer.style.left = '-9999px';
    this.shadow.appendChild(measurer);
    this.captionMeasurer = measurer;
    return measurer;
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

  /** Show a step's caption and active dot. Called when a step *starts*
   * animating (so the reader follows the text while the construction
   * draws) and again when it commits or is landed on statically. */
  private showStep(step: number): void {
    this.updateDots(step);
    const stepDef = this.prop?.steps[step - 1];
    // At step 0 the caption stays empty — the title sits directly above
    // the caption, so repeating it there would read as a duplicate.
    this.captionEl.textContent = step === 0 ? '' : stepDef?.text ?? '';
    // isAtStart/isAtEnd account for an in-flight forward transition via
    // the timeline's effectiveStep, so these stay correct whether we're
    // called at animation start or at commit.
    this.backBtn.disabled = this.timeline?.isAtStart ?? step <= 0;
    this.forwardBtn.disabled = this.timeline?.isAtEnd ?? step >= this.totalSteps();
  }

  private totalSteps(): number {
    return this.prop?.steps.length ?? 0;
  }

  private onStepChange(step: number, total: number): void {
    this.showStep(step);
    this.dispatchEvent(new CustomEvent('euclid-step', { detail: { step, total }, bubbles: true, composed: true }));
  }

  /** Re-run width-dependent layout (the reserved caption height). Public
   * so an embedding page can call it after changing layout inputs the
   * ResizeObserver can't see — e.g. setting --euclid-text-inset. */
  refreshLayout(): void {
    this.syncCaptionHeight();
  }

  private onPlayStateChange(state: 'paused' | 'playing'): void {
    this.playBtn.innerHTML = state === 'playing' ? ICONS.pause : ICONS.play;
    this.playBtn.setAttribute('aria-label', state === 'playing' ? 'Pause' : 'Play');
    // Play is never disabled: at the end it replays from the start.
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
