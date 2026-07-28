# 002 — Point the --ease-out token at a strong curve instead of the built-in keyword

- **Status**: TODO
- **Commit**: no-git — written 2026-07-28 against the working tree
- **Severity**: MEDIUM
- **Category**: Easing & duration / Cohesion & tokens
- **Estimated scope**: 1 file (styles.css), 1 line + feel check

## Problem

The repo's `--ease-out` token is an alias for the built-in CSS keyword, which
is too weak for deliberate motion — it lacks the punch that makes entrances
feel intentional:

```css
/* styles.css:11 — current */
  --ease-out: ease-out;
```

Every non-modal motion surface rides on it: the card entrance keyframes
(`styles.css:184`), card press feedback (`:194`), the hover chrome reveal
(`:232-234`), the playground header chip fade (`:400`), the Source/close chip
presses (`:436`, `:457`), and the presence cursor pop-in/out (`:512-513`).
Meanwhile the modal already owns a strong curve
(`--ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1)`), so the site's entrances
currently run on two different personalities — one crisp, one mushy.

## Target

```css
/* styles.css:11 — target */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* strong ease-out for UI */
```

This is the exact strong ease-out curve from the audit playbook. It is
deliberately close in character to the existing `--ease-smooth-out`
(cubic-bezier(0.22, 1, 0.36, 1)) so the whole site converges on one crisp
deceleration family.

## Repo conventions to follow

- All easing lives as tokens in `styles.css:5-13`; consumers only ever write
  `var(--ease-out)` — that is why this is a one-line change.
- Exemplar of the desired feel: the modal window transition at
  `styles.css:336-339`, which already uses the strong
  `--ease-smooth-out` curve.
- Do NOT touch the three intentional bare `ease` usages (color-only
  transitions at `styles.css:100`, `:435`, `:456`) — hover/color changes are
  correct on `ease` per the decision order.

## Steps

1. In `styles.css` line 11, replace `--ease-out: ease-out;` with
   `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` (keep the comment style of
   the surrounding token block; a short `/* strong ease-out for UI */` trailer
   is fine).

## Boundaries

- ONE declaration changes. Do not rename the token, do not touch any consumer,
  do not touch `--ease-smooth-out`.
- Do NOT touch `components/`, `app.js`, `presence.js`.

## Verification

- **Mechanical**: the stylesheet still parses (load the page, no fallback to
  default easing — check in DevTools → Computed that `.card-media`'s
  `transition-timing-function` shows the cubic-bezier, not `ease-out`).
- **Feel check** (DevTools Animations panel at 10%):
  - Reload: card entrance stagger now snaps into place early and settles
    gently instead of easing in mushily.
  - Hover a card: the label chip's 4px rise reads crisper; it must NOT bounce
    (this curve has no overshoot).
  - Press-and-hold a card: the 0.99 press dip starts immediately.
  - Watch a remote cursor appear (second tab): the pop-in reads snappier at
    the start of the scale.
- **Done when**: the computed timing function everywhere `var(--ease-out)` is
  consumed is `cubic-bezier(0.23, 1, 0.32, 1)` and the feel checks pass.
