# 001 — Stop the close flight from stretching real content, and make FLIP geometry interruption-proof

- **Status**: TODO
- **Commit**: no-git — written 2026-07-28 against the working tree
- **Severity**: HIGH
- **Category**: Physicality & origin / Interruptibility
- **Estimated scope**: 2 files (app.js, styles.css), ~25 lines

## Problem

Three defects in the playground's matched-geometry (FLIP) flight. All live in
`app.js` `openPlayground` / `closePlayground` and the `.is-morphing` rules in
`styles.css`.

**(a) The close flight stretches visible content.** The open flight hides the
header chips and iframe behind `.is-morphing` so its non-uniform scale only
ever stretches a solid surface. The close flight never adds that class, so the
title chip, the Source/close buttons, and the loaded demo iframe are
non-uniformly scaled for the whole ~150ms return flight:

```js
/* app.js:190-196 — current (note: no is-morphing) */
    if (source) {
      // Reverse flight: fade out while shrinking back toward the card.
      const first = win.getBoundingClientRect();
      const target = source.getBoundingClientRect();
      win.style.transformOrigin = '0 0';
      win.style.transform = flipTransform(target, first);
    }
```

**(b) Closing mid-open-flight aims at the wrong rect.** `getBoundingClientRect()`
includes the in-flight interpolated transform, but an inline `transform` is
applied relative to the *untransformed layout box*. Press Escape within ~250ms
of opening and `first` is the mid-flight rect, so the computed reverse
transform over-scales and the window flies somewhere that is not the card.

**(c) Reopening mid-close-flight starts from wrong geometry.** Same mechanism
in the other direction — `openPlayground` measures `last` at app.js:157 with
`win.getBoundingClientRect()` while the stale close-flight inline transform is
still applied (it is only cleared inside `closeTimer`, app.js:204, and cards
are already clickable because `shell.inert = false` is set synchronously).

```js
/* app.js:156-157 — current */
      const first = source.getBoundingClientRect();
      const last = win.getBoundingClientRect();
```

## Target

1. Close flight masks content exactly like the open flight (chips + iframe
   hidden while `.is-morphing` is on the window).
2. The mask is **instant** in both directions (no transition while morphing);
   the chips re-enter after landing with a 4px rise + fade, matching the card
   hover chrome (`opacity` + `translateY(4px)` → identity, 150ms).
3. All FLIP measurements of the *window* use transform-free layout metrics
   (`offsetLeft/offsetTop/offsetWidth/offsetHeight` — valid because the
   window's `offsetParent` is `.playground`, which is `position: fixed;
   inset: 0; border: 0`, so offsets are viewport coordinates). The *card* keeps
   `getBoundingClientRect()` (cards are never transformed at rest).

## Repo conventions to follow

- Motion tokens live in `styles.css` `:root` — durations `--duration-quick`
  (150ms) / `--duration-fast` (250ms), easing `--ease-out`.
- Exemplar for the chip reveal pattern: `styles.css:226-236` (`.card-label,
  .card-open` — `opacity: 0; transform: translateY(4px);` transitioning both
  at `var(--duration-quick) var(--ease-out)`).
- The FLIP helper `flipTransform(from, to)` at `app.js:123-126` stays as is.

## Steps

1. **app.js — add a layout-rect helper** next to `flipTransform` (after
   app.js:126):

   ```js
   function layoutRect(el) {
     // Transform-free geometry: offset* metrics ignore the inline FLIP
     // transform, so interrupted flights still measure the resting box.
     // Valid for .playground-window because its offsetParent (.playground)
     // is fixed at inset 0 with no border.
     return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
   }
   ```

2. **app.js `openPlayground`** — replace the `last` measurement (line 157):

   ```js
   const last = layoutRect(win);
   ```

   (`first` stays `source.getBoundingClientRect()`.)

3. **app.js `closePlayground`** — mask the flight and measure layout geometry.
   Replace the `if (source)` block (lines 190-196) with:

   ```js
   if (source) {
     // Reverse flight: mask content (like the open flight), then fade out
     // while shrinking back toward the card.
     win.classList.add('is-morphing');
     const first = layoutRect(win);
     const target = source.getBoundingClientRect();
     win.style.transformOrigin = '0 0';
     win.style.transform = flipTransform(target, first);
   }
   ```

   The existing `closeTimer` cleanup (app.js:199-206) already removes
   `is-morphing` and clears the inline styles — do not duplicate it.

4. **styles.css — make the morph mask instant, and give chips a landing
   entrance.** Replace the two `.is-morphing` child rules (currently lines
   372-383):

   ```css
   .playground-window.is-morphing {
     will-change: transform;
   }

   /* The mask must be instant in both directions — mid-flight content is
      what the mask exists to hide. */
   .playground-window.is-morphing .playground-head,
   .playground-window.is-morphing .playground-frame {
     opacity: 0;
     transition: none;
   }

   .playground-window.is-morphing .playground-head {
     transform: translateY(4px);
   }
   ```

5. **styles.css `.playground-head`** (line 388-401) — let the landing rise
   animate by adding transform to its transition:

   ```css
   transition:
     opacity var(--duration-quick) var(--ease-out),
     transform var(--duration-quick) var(--ease-out);
   ```

6. **styles.css reduced-motion block** (lines 557-580) — `.playground-head` is
   now transitioned; add it to the `transition-duration: 1ms` selector list.

## Boundaries

- Do NOT touch `components/`, `server.js`, `presence.js`, `catalog.js`.
- Do NOT change the open flight's structure (class order, reflow, timers) —
  only the one measurement in step 2.
- Do NOT add dependencies or new files.
- If line numbers have drifted such that an excerpt doesn't match, STOP and
  report instead of improvising.

## Verification

- **Mechanical**: `node --check app.js` exits 0. Serve with `node server.js`,
  open http://localhost:4321 — zero console errors.
- **Feel check** (DevTools → More tools → Animations, set to 10% speed):
  - Open any playground, then close it: during the return flight the window
    must read as a **solid colored surface** — no stretched title chip, no
    stretched demo content.
  - After an open flight lands, the title chip and buttons rise in with a
    small 4px lift (matching how card labels appear on hover), not a bare fade.
  - Press Escape ~100ms after clicking a card (mid-open-flight): the window
    must retarget smoothly and land exactly on the card it came from.
  - Immediately re-click a card while the close flight is running: the open
    flight must start from the card rect with no visible jump or wrong-size
    frame.
  - Toggle Rendering → Emulate `prefers-reduced-motion: reduce`: open/close
    are instant fades, no flight, no content stretch.
- **Done when**: all five feel checks pass at 10% speed and at full speed.
