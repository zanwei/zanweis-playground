# zanwei's playground

A live gallery of eight hand-built web components, laid out after
[recent.design](https://recent.design): column masonry, a boot intro, and a
multiplayer layer — shared cursors, Bullet screen, an emoji fountain (hold L),
and a who's-here globe.

## Run

```bash
node server.js          # local, zero dependencies → http://localhost:4321
```

```bash
npx wrangler dev        # Cloudflare Worker simulator (WebSocket presence)
```

Video range delivery uses per-entrypoint Workers Cache and requires Wrangler
4.107.0 or newer.

## Deploy (Cloudflare)

```bash
npx wrangler login      # once, interactive
npx wrangler deploy
```

Static files ship via Workers Assets; presence runs in one Durable Object
room (`src/worker.js`). `wrangler.jsonc` carries the whole config.

## How it works

**Cards are the real components.** Each masonry card embeds the component
repo's own demo page (vendored under `components/`) in an iframe, scaled to
the card, primed into a presentable resting state, and frozen once settled so
idle previews cost no main-thread time. Clicking a card opens the playground —
a FLIP matched-geometry modal with a fresh interactive copy.

**Cursors are anchored, not absolute.** Positions travel as
`(anchor, fx, fy)` — fractions of a card's box — so cursors point at the same
component on every screen, whatever the column count.

**Transport is a ladder.** WebSocket against the deployed Worker (Durable
Object; `ws.send` is context-free where cross-request stream writes are not),
SSE against `node server.js`, BroadcastChannel on static hosting. The same
message protocol rides all three.

**Everything degrades before it falls over.** Cursor fan-out runs per-event
in small rooms and coalesces into 20Hz tick frames in crowds; ingest is
rate-floored per peer; bullets sit behind a token bucket plus a global
budget; slow consumers are evicted; connections hard-cap at 1200; clients
adapt their report rate to the room and cap what they render.

## Components

| Card | Repo |
| --- | --- |
| Status Indicator | [status-indicator-web-component](https://github.com/zanwei/status-indicator-web-component) |
| Ball Model Picker | [ball-model-picker](https://github.com/zanwei/ball-model-picker) |
| Delete Confirm Dialog | [dialog-web-component](https://github.com/zanwei/dialog-web-component) |
| Claude Model Selector | [claude-model-selector](https://github.com/zanwei/claude-model-selector) |
| Liquid Connector | [liquid-connector-web-component](https://github.com/zanwei/liquid-connector-web-component) |
| Model Picker | [model-picker](https://github.com/zanwei/model-picker) |
| Table of Contents | [table-of-content-component](https://github.com/zanwei/table-of-content-component) |
| ChatGPT Model Selector | [chatgpt-model-selector](https://github.com/zanwei/chatgpt-model-selector) |

`components/` holds vendored snapshots of these repos.

## Files

- `server.js` — zero-dependency static server + SSE presence relay (local)
- `src/worker.js` — Cloudflare Worker: Workers Assets + Durable Object room
- `presence.js` — transport ladder, anchor math, remote cursor rendering
- `app.js` — masonry, FLIP playground modal, count UI, presence wiring
- `social.js` — globe popover, Bullet screen, toasts
- `fountain.js` — hold-L emoji fountain (pooled particles)
- `boot.js` / `faces.js` — the shuffling-face intro and its pixel sprites
- `styles.css` — layout and motion; tokens follow the transitions.dev scale
