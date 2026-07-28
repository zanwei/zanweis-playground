# 003 — Frame-rate-independent cursor damping, cheaper presence frames, interruptible leave

- **Status**: TODO
- **Commit**: no-git — written 2026-07-28 against the working tree
- **Severity**: MEDIUM
- **Category**: Performance / Interruptibility (presence layer)
- **Estimated scope**: 1 file (presence.js), ~40 lines

## Problem

Four related defects in `presence.js`, all in the remote-cursor path:

**(a) Damping is per-frame, so feel depends on refresh rate.**

```js
/* presence.js:91-93 — current */
      const k = reduceMotion.matches ? 1 : 0.28;
      this.x += (p.x - this.x) * k;
      this.y += (p.y - this.y) * k;
```

At 120Hz (every ProMotion Mac/iPad) the cursor converges twice as stiffly as
at 60Hz; at 30Hz it lags. The smoothing constant must be normalized by frame
delta time.

**(b) Per-frame document-wide query.** `resolve()` (presence.js:66) runs
`document.querySelector('[data-anchor="…"]')` for every cursor on every
animation frame. The anchor element only changes when the *target* changes.

**(c) Hit-test at pointermove rate.** `anchorFor()` (elementFromPoint +
getBoundingClientRect) runs on every `pointermove` (presence.js:285) even
though results are only consumed every 40ms (`SEND_INTERVAL`).

**(d) The leave animation is not interruptible.** `remove()`
(presence.js:100-106) orphans the node for `LEAVE_MS` while `dropPeer` deletes
the map entry immediately — a peer who goes idle and instantly returns gets a
second cursor while the ghost of the first is still fading. Also
`LEAVE_MS = 180` claims to match the CSS leave transition, but
`.presence-cursor.is-leaving .presence-cursor-inner` runs at
`var(--duration-quick)` = 150ms.

**(e) The rAF loop never idles.** presence.js:177-180 re-schedules
`requestAnimationFrame` forever, even with zero cursors on screen.

## Target

- Damping uses exponential time-based smoothing: `k = 1 − exp(−dt / 51)` with
  `dt` in ms, clamped `dt = min(dt, 250)`. τ = 51ms reproduces the current
  60Hz feel exactly (`16.7 / −ln(1 − 0.28) ≈ 50.7`). Reduced motion keeps
  `k = 1`.
- The anchor element is resolved once per `setTarget` and cached; `resolve()`
  re-queries only if the cached element is no longer `isConnected`.
- `anchorFor` runs only when a report is actually sent (inside the throttle
  branch and the trailing flush) — `pointermove` stores only raw
  `{x, y}` coordinates.
- `remove()` marks the cursor as leaving but keeps it in the map;
  `peerCursor()` revives a leaving cursor (cancel timer, clear class, reset
  `placed`) instead of creating a duplicate. The map entry is deleted in the
  timer. `LEAVE_MS` derives from the CSS token:
  `parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-quick')) + 30`.
- The loop stops scheduling when `cursors.size === 0` and is restarted by
  `peerCursor()`.

## Repo conventions to follow

- app.js already reads motion tokens at runtime — exemplar `app.js:28-31`
  (`tokenMs('--duration-quick', 150)`); mirror that pattern locally in
  presence.js (it has no shared import mechanism — copy the two-line helper).
- Comment style: short sentence comments explaining *why*, as at
  presence.js:68-69.

## Steps

1. **Damping (a):** change the render loop (presence.js:176-180) to compute a
   clamped per-frame delta and pass it to `tick`:

   ```js
   // render loop — pause entirely when no cursors are on the page
   let rafId = null;
   let lastFrame = 0;
   function frame(now) {
     rafId = null;
     const dt = Math.min(250, now - (lastFrame || now));
     lastFrame = now;
     for (const c of cursors.values()) c.tick(now, dt);
     if (cursors.size > 0) rafId = requestAnimationFrame(frame);
     else lastFrame = 0;
   }
   function ensureLoop() {
     if (rafId === null) rafId = requestAnimationFrame(frame);
   }
   ensureLoop();
   ```

   In `tick(now, dt)` replace the constant:

   ```js
   // Exponential time-based damping: identical feel at 60/120/144Hz.
   const k = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / 51);
   ```

2. **Anchor cache (b):** in `setTarget`, resolve and cache the element when
   the anchor string changes:

   ```js
   setTarget(anchor, fx, fy) {
     if (!this.target || this.target.anchor !== anchor) {
       this.anchorEl =
         anchor === 'page' ? null : document.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
     }
     this.target = { anchor, fx, fy };
     this.seenAt = performance.now();
   }
   ```

   In `resolve()`, use `this.anchorEl`, re-querying only when
   `!this.anchorEl?.isConnected`.

3. **Send-time hit-test (c):** in the `pointermove` handler store
   `pending = { x: e.clientX, y: e.clientY }` and call
   `anchorFor(pending.x, pending.y)` inside the throttled send branch and in
   the trailing-flush interval, immediately before `send(...)`.

4. **Interruptible leave (d):** give `RemoteCursor` a `leave(onDone)` method:

   ```js
   leave(onDone) {
     this.leaving = true;
     this.el.classList.remove('is-in');
     this.el.classList.add('is-leaving');
     this.leaveTimer = setTimeout(() => { this.el.remove(); onDone(); }, LEAVE_MS);
   }
   revive() {
     clearTimeout(this.leaveTimer);
     this.leaving = false;
     this.el.classList.remove('is-leaving');
     this.placed = false; // pops back in from the tip
   }
   ```

   `dropPeer` calls `cursor.leave(() => cursors.delete(id))` instead of
   deleting immediately; `peerCursor` calls `revive()` when it finds a leaving
   cursor. Compute `LEAVE_MS` from `--duration-quick` + 30 at module init and
   fix the stale comment.

5. **Loop wake-up (e):** `peerCursor()` calls `ensureLoop()` after inserting a
   new cursor (and after `revive()`).

## Boundaries

- presence.js only. Do NOT touch the transport code (SSE/BroadcastChannel
  sections), the anchor protocol, or any CSS.
- Do NOT change public behavior: message shapes, `Presence.start` signature,
  and the `focus()` API stay identical.
- If an excerpt doesn't match the code, STOP and report.

## Verification

- **Mechanical**: `node --check presence.js` exits 0; page loads with zero
  console errors; two tabs still see each other's cursors and focus dots.
- **Feel check**:
  - Two tabs side by side: move the mouse in slow circles in one — the remote
    cursor follows with the same lag as before at 60Hz (no change in feel).
  - If a ProMotion display is available, verify the follow feel matches the
    60Hz display (previously it snapped harder).
  - Trigger idle (switch tabs) and return + move within ~150ms: exactly one
    cursor, popping back in from the tip — never two overlapping arrows.
  - DevTools Performance panel, 10s idle with no remote cursors: no per-frame
    scripting from presence.js (the loop is parked).
- **Done when**: all four checks pass and cursor motion is visually identical
  at 60Hz to the pre-change build.
