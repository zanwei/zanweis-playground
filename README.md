# zanwei's playground

A live gallery of eight hand-built web components, laid out after
[recent.design](https://recent.design): sticky sidebar, filter pills, column
masonry — and shared cursors, so everyone on the page sees everyone else.

## Run

```bash
node server.js
```

Open http://localhost:4321. No dependencies, no build step.

## How it works

**Cards are the real components.** Each masonry card embeds the component
repo's own `index.html` in an iframe, rendered at a fixed design viewport and
scaled to the card. Same-origin access lets the gallery nudge demos into a
presentable resting state (open a picker panel, hide a debug inspector).
Clicking a card opens the playground: a modal with a fresh, fully interactive
copy of the demo.

**Cursors are anchored, not absolute.** Every card carries a `data-anchor`
attribute. A cursor position is reported as `(anchor, fx, fy)` — fractions of
that anchor's box — so cursors land on the *same card* for every viewer even
when the masonry reflows to a different column count. This mirrors how
recent.design's presence layer (visitors.now) does it.

**Transport degrades honestly.** With `server.js` running, presence flows over
SSE (`GET /presence/stream`) with `POST /presence/event` upstream. On static
hosting the client falls back to a BroadcastChannel, which still gives real
presence across your own open tabs. No fabricated ghost cursors.

## Components

| Card | Repo |
| --- | --- |
| Status Indicator | [status-indicator-web-component](https://github.com/zanwei/status-indicator-web-component) |
| Ball Model Picker | [ball-model-picker](https://github.com/zanwei/ball-model-picker) |
| Delete Confirm Dialog | [dialog-web-component](https://github.com/zanwei/dialog-web-component) |
| Claude Model Selector | [claude-model-selector](https://github.com/zanwei/claude-model-selector) |
| Liquid Connector | [liquid-connector-web-component](https://github.com/zanwei/liquid-connector-web-component) |
| Model Picker | [model-picker](https://github.com/zanwei/model-picker) |
| Table of Content | [table-of-content-component](https://github.com/zanwei/table-of-content-component) |
| ChatGPT Model Selector | [chatgpt-model-selector](https://github.com/zanwei/chatgpt-model-selector) |

The `components/` folder holds shallow clones of these repos; refresh one with
`git -C components/<repo> pull`.

## Files

- `server.js` — zero-dependency static server + SSE presence relay
- `presence.js` — cursor reporting, anchor resolution, remote cursor rendering
- `app.js` — masonry, filters, playground modal, presence wiring
- `catalog.js` — per-component embed config (viewport, aspect, prime hooks)
- `styles.css` — layout and motion; tokens follow the transitions.dev scale
