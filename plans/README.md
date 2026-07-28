# Animation improvement plans

Written by `/improve-animations` on 2026-07-28 (no git repo — plans reference
the working tree as of that date). Audit: 4 parallel category auditors over
styles.css / app.js / presence.js / index.html; ~30 raw findings, 16 confirmed
by line-level vetting, 7 rejected as by-design or mis-scoped.

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | [Close-flight content stretch + interruption-proof FLIP geometry](001-close-flight-content-stretch.md) | HIGH | DONE |
| 002 | [Strengthen the --ease-out token](002-strengthen-ease-out-token.md) | MEDIUM | DONE |
| 003 | [Presence cursor: dt-normalized damping, cheaper frames, interruptible leave](003-presence-cursor-motion-quality.md) | MEDIUM | DONE |
| 004 | [Convention sweep: tokens, press ranges, a11y gaps](004-convention-sweep.md) | MEDIUM | DONE |

## Execution order and dependencies

1. **001** first — it fixes a user-visible HIGH (stretched content on every
   modal close) and rewrites the FLIP measurement helpers that nothing else
   touches.
2. **002** any time — one line; do it before 004 so feel checks for both run
   against the strong curve.
3. **003** standalone (presence.js only).
4. **004** last — it sweeps the remaining files and its feel checks double as
   a regression pass for 001/002.

No plan depends on another's code, but 003 and any future presence.js work
must not run concurrently (same lines).

## Vetted but unplanned (below plan granularity)

- Missed opportunity: per-card visitor dots teleport in/out
  (`app.js` `onFocus`) — enter pop / exit fade plus diff-based updates would
  suit the presence layer's character. Run
  `/improve-animations plan visitor-dot-entrances` if wanted.
- Missed opportunity: the live online count swaps digits instantly
  (`app.js` `onCount`) — a 150ms micro text swap would suit the topbar.

## Notable rejections (do not re-report)

- FLIP flight on `--ease-smooth-out` instead of ease-in-out: the flight
  doubles as the modal's entrance; responsiveness at takeoff wins.
- Symmetric 150ms press/release on cards and chips: matches the playbook's own
  press-feedback prescription; the asymmetry rule targets hold-to-confirm.
- Cursor pop from `scale(0.6)`: tip-anchored bloom on a 24px glyph,
  recent.design parity — deliberate.
- Card press at `scale(0.99)`: documented "barely-there for a large surface".
- Bare `ease` on color-only transitions: correct per the decision order.
