# 004 — Convention sweep: tokenize hand-typed motion values, align press ranges, close a11y gaps

- **Status**: TODO
- **Commit**: no-git — written 2026-07-28 against the working tree
- **Severity**: MEDIUM (aggregate of vetted LOW/MEDIUM cohesion + a11y findings)
- **Category**: Cohesion & tokens / Physicality / Accessibility
- **Estimated scope**: 3 files (styles.css, app.js, index.html), ~15 small edits

## Problem

Hand-typed values duplicate or sit just off the declared token scale, two
press states fall outside the 0.95–0.98 range, the keyboard reveal of card
chips is trapped inside a pointer media query, and several transitioned
controls are missing from the reduced-motion list.

Current code:

```js
/* app.js:46 — stagger interval duplicates --duration-stagger (40ms) */
card.style.setProperty('--enter-delay', `${Math.min(index, 8) * 40}ms`);
```

```css
/* styles.css:172-186 — hand-typed 8px and 300ms in the entrance */
@keyframes card-enter {
  from { opacity: 0; transform: translateY(8px); }
  ...
.card.enter {
  animation: card-enter 300ms var(--ease-out) both;

/* styles.css:511-513 — cursor pop hand-types 200ms twice */
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);

/* styles.css:464-466 — close button press below the 0.95–0.98 range */
.playground-close:active { transform: scale(0.94); }

/* styles.css:264-272 — keyboard reveal only exists inside the hover MQ */
@media (hover: hover) and (pointer: fine) {
  .card-media:hover .card-label,
  ...
  .card-hit:focus-visible ~ .card-label,
  .card-hit:focus-visible ~ .card-open { ... }
}

/* index.html:19 + styles.css:107-117 — .brand is pressable, no press state */
```

## Target

- All five hand-typed values reference tokens:
  `--duration-stagger` (JS-read), `--duration-fast` (card entrance, 300 → 250ms),
  `--distance-base` (8px), `--duration-quick` (cursor pop, 200 → 150ms).
- `.playground-close:active` presses to `scale(0.97)` (matching
  `.playground-source`).
- `.brand` gets press feedback:
  `transition: transform var(--duration-quick) var(--ease-out);` and
  `.brand:active { transform: scale(0.97); }`.
- The `:focus-visible` chip reveal is duplicated OUTSIDE the hover media query
  at top level (keyboard reveal must not depend on pointer capabilities).
- Reduced-motion list additionally covers `.playground-source`,
  `.playground-close`, `.brand`, `.topbar`.

## Repo conventions to follow

- Token block: `styles.css:5-13`. JS token reads: `tokenMs()` at `app.js:28-31`.
- `var()` inside `@keyframes` is valid and already the repo's direction —
  keep the keyframes, only swap values for `var(--distance-base)` /
  `var(--duration-fast)`.

## Steps

1. app.js:46 → `` card.style.setProperty('--enter-delay', `${Math.min(index, 8) * tokenMs('--duration-stagger', 40)}ms`); ``
   (Note: `tokenMs` is declared at app.js:28 — it is in scope.)
2. styles.css:175 `translateY(8px)` → `translateY(var(--distance-base))`.
3. styles.css:184 `animation: card-enter 300ms var(--ease-out) both;` →
   `animation: card-enter var(--duration-fast) var(--ease-out) both;`
4. styles.css:511-513 both `200ms` → `var(--duration-quick)`.
5. styles.css:465 `scale(0.94)` → `scale(0.97)`.
6. styles.css `.brand` rule (107-117): append
   `transition: transform var(--duration-quick) var(--ease-out);` and add a
   sibling rule `.brand:active { transform: scale(0.97); }`.
7. styles.css: move the two `:focus-visible` selectors out of the
   `@media (hover: hover)` block into a new top-level rule:

   ```css
   .card-hit:focus-visible ~ .card-label,
   .card-hit:focus-visible ~ .card-open {
     opacity: 1;
     transform: translateY(0);
   }
   ```

   (Keep the hover selectors inside the MQ unchanged.)
8. styles.css reduced-motion block: add `.playground-source`,
   `.playground-close`, `.brand`, `.topbar` to the
   `transition-duration: 1ms` selector list.

## Boundaries

- Do NOT change any easing choices (bare `ease` on color transitions at
  styles.css:100/435/456 is deliberate and stays).
- Do NOT touch presence.js (LEAVE_MS is handled by plan 003), `components/`,
  `server.js`.
- Values only — no selector restructuring beyond steps 6-8.

## Verification

- **Mechanical**: page loads with zero console errors; DevTools → Computed on
  `.card.enter` shows `animation-duration: 0.25s`; on
  `.presence-cursor-inner` shows `transition-duration: 0.15s, 0.15s`.
- **Feel check**:
  - Reload: entrance stagger unchanged in rhythm (40ms steps), slightly
    quicker per card (250ms) — still settles calmly.
  - Tab to a card with the keyboard on any device: label + arrow chips appear.
  - Click the topbar Z mark: it dips to 0.97 and springs back.
  - Reduced motion emulation: pressing chips/close/brand gives no visible
    scale animation.
- **Done when**: all four feel checks pass.
