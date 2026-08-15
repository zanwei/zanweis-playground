/*
 * Lightbox — a "connected filmstrip" image preview component.
 * Three layers: a fixed stage, a morphing clip window (clip-path: inset),
 * and a rigid zero-gap filmstrip (translateX). Both animated layers share
 * one timeline and one easing curve. Layout math lives in geometry.js.
 */
import { computeFits, clipOf, stripXOf } from './geometry.js';

const NAV_MS = 550;
const NAV_EASE = 'cubic-bezier(0.4, 0, 0, 1)';   // soft start + long deceleration tail
const RETARGET_MS = 400;
const RETARGET_EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)'; // non-zero initial slope: picks up current velocity
const OPEN_MS = 220;
const OPEN_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const CLOSE_MS = 160;
const FADE_MS = 150;                              // reduced-motion fade-through total
const MARGIN = 48;                                // safe distance between image and stage edges
const FALLBACK_W = 1200, FALLBACK_H = 900;        // placeholder box for images that failed to load

export class Lightbox {
  constructor(sources) {
    this.sources = sources.map((s) => (typeof s === 'string' ? { src: s, alt: '' } : s));
    this.index = 0; this.items = []; this.fits = []; this.anims = [];
    this.loadPromise = null; this.closing = false;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.buildDom();
    this.bindEvents();
  }

  buildDom() {
    const el = document.createElement('div');
    el.className = 'lb-stage';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Image preview');
    el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML = `
      <div class="lb-frame"><div class="lb-strip"></div></div>
      <button class="lb-close" aria-label="Close">&#x2715;</button>
      <button class="lb-prev" aria-label="Previous">&#x2039;</button>
      <button class="lb-next" aria-label="Next">&#x203A;</button>
      <p class="lb-counter" role="status"></p>`;
    const q = (s) => el.querySelector(s);
    this.stage = el; this.frame = q('.lb-frame'); this.strip = q('.lb-strip');
    this.btnClose = q('.lb-close'); this.btnPrev = q('.lb-prev'); this.btnNext = q('.lb-next');
    this.counter = q('.lb-counter');
    document.body.appendChild(el);
  }

  bindEvents() {
    this.btnClose.addEventListener('click', () => this.close());
    this.btnPrev.addEventListener('click', () => this.goTo(this.index - 1));
    this.btnNext.addEventListener('click', () => this.goTo(this.index + 1));
    // Backdrop close: primary pointer + left button only, both down and up on the
    // backdrop, travel < 12px — never swallows drags, multi-touch or right clicks.
    const bg = (t) => t === this.stage || t === this.frame || t === this.strip;
    this.stage.addEventListener('pointerdown', (e) => {
      this.press = e.isPrimary && e.button === 0 && bg(e.target) ? { x: e.clientX, y: e.clientY } : null;
    });
    this.stage.addEventListener('pointerup', (e) => {
      if (this.press && bg(e.target) && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) < 12) this.close();
      this.press = null;
    });
    this.stage.addEventListener('pointercancel', () => (this.press = null));
    this.onKey = (e) => {
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowRight') this.goTo(this.index + 1);
      else if (e.key === 'ArrowLeft') this.goTo(this.index - 1);
    };
    this.onResize = () => { if (!this.stage.hidden) { this.layout(); this.settle(this.index); } };
  }

  load() { return (this.loadPromise ??= this.doLoad()); }

  async doLoad() {
    this.items = await Promise.all(this.sources.map(async ({ src, alt }) => {
      const img = new Image();
      Object.assign(img, { src, alt, className: 'lb-slide', draggable: false });
      await img.decode().catch(() => {});   // one broken image must not break the viewer
      return { img, w: img.naturalWidth || FALLBACK_W, h: img.naturalHeight || FALLBACK_H };
    }));
    for (const it of this.items) this.strip.appendChild(it.img);
  }

  layout() {
    this.W = this.stage.clientWidth; this.H = this.stage.clientHeight;
    this.fits = computeFits(this.items, this.W, this.H, MARGIN);
    this.items.forEach(({ img }, i) => {
      const f = this.fits[i];
      img.style.cssText = `left:${f.off}px;top:${f.y}px;width:${f.w}px;height:${f.h}px`;
    });
  }

  cancelAnims() { for (const a of this.anims) a.cancel(); this.anims = []; }

  /* Rest instantly, no animation: open, resize, animation cleanup, reduced motion. */
  settle(i) {
    this.cancelAnims();
    this.frame.style.clipPath = clipOf(this.fits[i], this.W, this.H);
    this.strip.style.transform = `translateX(${stripXOf(this.fits[i])}px)`;
  }

  goTo(j) {
    if (j < 0 || j >= this.items.length) return;
    const active = this.anims.length > 0;
    if (j === this.index && !active) return;
    // Only the visible phase (time progress < 50%) counts as a real interruption.
    // A click in the quiet tail is treated as a fresh from-rest navigation so the
    // rhythm stays consistent.
    const timeProg = active ? (this.anims[0].effect.getComputedTiming().progress ?? 1) : 1;
    const midFlight = active && timeProg < 0.5;
    this.index = j;
    this.updateChrome();                       // chrome responds instantly, motion follows
    if (this.reduced.matches) return this.fadeThrough(j);
    const fromClip = active ? getComputedStyle(this.frame).clipPath : this.frame.style.clipPath;
    const fromX = active ? getComputedStyle(this.strip).transform : this.strip.style.transform;
    this.cancelAnims();
    const timing = midFlight
      ? { duration: RETARGET_MS, easing: RETARGET_EASE, fill: 'forwards' }
      : { duration: NAV_MS, easing: NAV_EASE, fill: 'forwards' };
    this.anims = [
      this.frame.animate({ clipPath: [fromClip, clipOf(this.fits[j], this.W, this.H)] }, timing),
      this.strip.animate({ transform: [fromX, `translateX(${stripXOf(this.fits[j])}px)`] }, timing),
    ];
    Promise.all(this.anims.map((a) => a.finished))
      .then(() => this.settle(this.index))     // rest + cleanup, same path as open/resize
      .catch(() => {});                        // silent when retargeted mid-flight
  }

  /* Reduced-motion fallback: two-phase fade-through, no translation. */
  fadeThrough(j) {
    const out = this.frame.animate({ opacity: [1, 0] }, { duration: FADE_MS / 2, easing: 'ease-in', fill: 'forwards' });
    this.anims = [out];
    out.finished.then(() => {
      if (this.index !== j || !this.anims.includes(out)) return;  // navigated again mid-fade
      this.settle(j);                          // settle's cancelAnims clears the forwards fill
      const fadeIn = this.frame.animate({ opacity: [0, 1] }, { duration: FADE_MS / 2, easing: 'ease-out' });
      this.anims = [fadeIn];
      fadeIn.finished.then(() => { if (this.anims.includes(fadeIn)) this.anims = []; }, () => {});
    }, () => {});
  }

  updateChrome() {
    // If a button is focused when it gets disabled, hand focus to the stage first
    // so Tab cannot fall out of the dialog through a focus reset to <body>.
    const setDisabled = (btn, off) => {
      if (off && document.activeElement === btn) this.stage.focus({ preventScroll: true });
      btn.disabled = off;
    };
    setDisabled(this.btnPrev, this.index === 0);
    setDisabled(this.btnNext, this.index === this.items.length - 1);
    this.counter.textContent = `${this.index + 1} / ${this.items.length}`;
    // Fold the first announcement into the dialog name: a live region that enters
    // the tree with initial content is not announced by screen readers.
    this.stage.setAttribute('aria-label', `Image preview, ${this.index + 1} of ${this.items.length}`);
    this.items.forEach((it, k) => it.img.setAttribute('aria-hidden', String(k !== this.index)));
  }

  /* Isolate the background while open: focus containment + a11y-tree removal. */
  setBackgroundInert(on) {
    for (const el of document.body.children) {
      if (el === this.stage || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) continue;
      el.toggleAttribute('inert', on);
    }
  }

  async open(i = 0) {
    this.opener = document.activeElement;
    await this.load();
    this.index = i; this.closing = false;
    this.stage.hidden = false;
    document.body.style.overflow = 'hidden';
    this.setBackgroundInert(true);
    this.layout();
    this.settle(i);
    this.updateChrome();
    addEventListener('keydown', this.onKey); addEventListener('resize', this.onResize);
    this.stage.focus({ preventScroll: true });
    const t = { duration: OPEN_MS, easing: OPEN_EASE };
    this.stage.animate({ opacity: [0, 1] }, t);
    if (!this.reduced.matches) this.frame.animate({ transform: ['scale(0.97)', 'scale(1)'] }, t);
  }

  close() {
    if (this.stage.hidden || this.closing) return;
    this.closing = true;
    if (this.anims.length) {                   // closed mid-navigation: freeze, don't jump-cut
      this.frame.style.clipPath = getComputedStyle(this.frame).clipPath;
      this.strip.style.transform = getComputedStyle(this.strip).transform;
    }
    this.cancelAnims();
    removeEventListener('keydown', this.onKey);
    removeEventListener('resize', this.onResize);
    const from = getComputedStyle(this.stage).opacity; // continue from current value if opening
    const a = this.stage.animate({ opacity: [from, 0] }, { duration: CLOSE_MS, easing: 'ease-out' });
    a.finished.then(() => {
      if (!this.closing) return;               // re-opened during the fade
      this.closing = false;
      this.stage.hidden = true;
      document.body.style.overflow = '';
      this.setBackgroundInert(false);
      this.opener?.focus?.();
    }).catch(() => (this.closing = false));
  }
}
