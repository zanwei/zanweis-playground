#!/usr/bin/env node
/**
 * zanwei's playground — static server + cursor presence.
 * Zero dependencies: `node server.js` and open http://localhost:4321
 *
 * Presence protocol (mirrors what recent.design does via visitors.now):
 *   GET  /presence/stream        SSE. Server assigns {id, color}, then relays
 *                                join / cursor / focus / leave / count events.
 *   POST /presence/event         One JSON event from a client, relayed to others.
 *   like {card, on}               Idempotent, process-persistent card reaction.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

// Semantic color names, resolved to var(--presence-<name>) by the client —
// the stylesheet stays the single source of truth for the actual values.
const CURSOR_COLORS = ['orange', 'violet', 'green', 'pink', 'blue', 'amber'];
let colorCursor = 0;
let nextId = 1;

/**
 * Scale guards. Naive relay is O(events × peers): 1000 visitors at 25
 * cursor events/s each would mean 25M writes/s. Instead cursors are
 * coalesced into a fixed-rate tick, ingest is rate-limited per peer,
 * bullets sit behind a token bucket plus a global budget, slow consumers
 * are evicted, and connections hard-cap. Everything degrades before
 * anything falls over.
 */
const MAX_PEERS = 1200; // SSE connections beyond this get 503
const REALTIME_MAX = 12; // small rooms skip the tick: relay per-event, live
const TICK_MS = 50; // crowded cursor fan-out runs at 20Hz, never per-event
const TICK_CURSOR_CAP = 40; // most cursor entries carried per tick frame
const CURSOR_MIN_MS = 30; // per-peer cursor ingest floor when crowded
const CURSOR_MIN_RT_MS = 15; // ~66Hz ceiling in the realtime tier
const META_MIN_MS = 900; // per-peer focus/loc ingest floor
const BULLET_BURST = 3; // token bucket: burst of 3…
const BULLET_REFILL_MS = 2500; // …refilling one every 2.5s
const BULLET_GLOBAL_PER_SEC = 25; // whole-site bullet budget
const SLOW_LIMIT = 256 * 1024; // unread SSE backlog before eviction
const ROSTER_CAP = 200; // hello snapshot detail cap
const LIKE_MIN_MS = 120; // per-peer floor; a SET never needs pointer-rate traffic
const LIKE_CARDS = new Set([
  'status-indicator',
  'ball-model-picker',
  'dialog',
  'claude-model-selector',
  'liquid-connector',
  'model-picker',
  'table-of-content',
  'chatgpt-model-selector',
  'dia-logo',
  'linear-logo',
  'fontdetector-logo',
  'clear-logo',
  'macintosh-logo',
  'affine-logo',
  'affine-hero',
  'bridge',
]);
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** id -> { res, color, token, clientId, lastEvent, loc, cursorAt, metaAt, likeAt, bTokens, bAt } */
const peers = new Map();
/** card slug -> stable anonymous client IDs that currently like it. */
const likesByCard = new Map([...LIKE_CARDS].map((card) => [card, new Set()]));

function clientIdFor(req) {
  let candidate = '';
  try {
    candidate = new URL(req.url, 'http://localhost').searchParams.get('client') || '';
  } catch {
    /* a malformed URL receives a fresh anonymous identity */
  }
  return CLIENT_ID_RE.test(candidate) ? candidate : crypto.randomUUID();
}

function likesSnapshot(clientId) {
  const counts = {};
  const mine = [];
  for (const [card, clients] of likesByCard) {
    counts[card] = clients.size;
    if (clients.has(clientId)) mine.push(card);
  }
  return { counts, mine };
}

function evict(id, peer) {
  peers.delete(id);
  try {
    peer.res.destroy();
  } catch {
    /* already gone */
  }
}

function broadcast(payload, exceptId) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [id, peer] of peers) {
    if (id === exceptId) continue;
    // A consumer that stopped reading would buffer this process into the
    // ground — cut it loose; its EventSource reconnects when it recovers.
    if (peer.res.writableLength > SLOW_LIMIT) {
      evict(id, peer);
      continue;
    }
    peer.res.write(line);
  }
}

// Like SETs are acknowledged immediately to every live tab sharing the
// actor's stable client ID. Changed counts join the 50 ms tick below so a
// burst costs one room-wide frame instead of one fanout per event.
function publishLike(card, count, clientId, on, changed) {
  if (changed) pendingLikeCounts.set(card, count);
  for (const [id, peer] of peers) {
    if (peer.clientId !== clientId) continue;
    if (peer.res.writableLength > SLOW_LIMIT) {
      evict(id, peer);
      continue;
    }
    peer.res.write(`data: ${JSON.stringify({ t: 'like', card, count, on })}\n\n`);
  }
}

// --- room tick: coalesced cursors and like counts, flushed as frames -------

const pendingCursors = new Map(); // id -> { a, fx, fy }
const pendingLikeCounts = new Map(); // card -> latest authoritative count
let countDirty = false;
let tickTimer = null;

function tick() {
  if (peers.size === 0) {
    clearInterval(tickTimer);
    tickTimer = null;
    pendingCursors.clear();
    pendingLikeCounts.clear();
    return;
  }
  if (countDirty) {
    countDirty = false;
    broadcast({ t: 'count', n: peers.size });
  }
  if (pendingLikeCounts.size) {
    const counts = Object.fromEntries(pendingLikeCounts);
    pendingLikeCounts.clear();
    broadcast({ t: 'likes', counts });
  }
  if (pendingCursors.size === 0) return;
  const list = [];
  for (const [id, c] of pendingCursors) {
    const peer = peers.get(id);
    if (peer) list.push({ id, a: c.a, fx: c.fx, fy: c.fy, color: peer.color });
    pendingCursors.delete(id);
    if (list.length >= TICK_CURSOR_CAP) break; // the rest ride the next tick
  }
  if (list.length) broadcast({ t: 'cursors', list });
}

function ensureTick() {
  if (tickTimer === null) tickTimer = setInterval(tick, TICK_MS);
}

// --- global bullet budget --------------------------------------------------

let bulletWindowStart = 0;
let bulletWindowCount = 0;

function bulletBudgetOk(now) {
  if (now - bulletWindowStart >= 1000) {
    bulletWindowStart = now;
    bulletWindowCount = 0;
  }
  return ++bulletWindowCount <= BULLET_GLOBAL_PER_SEC;
}

function presenceStream(req, res) {
  if (peers.size >= MAX_PEERS) {
    // Full house. The client's EventSource fails before "hello" and falls
    // back to tab-local presence — the page keeps working.
    res.writeHead(503, { 'Retry-After': '30' }).end();
    return;
  }

  const id = String(nextId++);
  const color = CURSOR_COLORS[colorCursor++ % CURSOR_COLORS.length];
  const clientId = clientIdFor(req);
  // The POST channel proves identity with this token, so one visitor can't
  // puppeteer another's cursor by guessing their (sequential) id.
  const token = crypto.randomBytes(12).toString('hex');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Tell the newcomer who they are and who is already here. The detailed
  // snapshot caps out — beyond it the count alone tells the story.
  const roster = [];
  for (const [pid, p] of peers) {
    if (roster.length >= ROSTER_CAP) break;
    roster.push({ id: pid, color: p.color, last: p.lastEvent || null, loc: p.loc || null });
  }
  res.write(
    `data: ${JSON.stringify({
      t: 'hello',
      id,
      color,
      token,
      clientId,
      peers: roster,
      likes: likesSnapshot(clientId),
    })}\n\n`
  );

  const now = Date.now();
  peers.set(id, {
    res,
    color,
    token,
    clientId,
    lastEvent: null,
    loc: null,
    cursorAt: 0,
    metaAt: 0,
    likeAt: 0,
    bTokens: BULLET_BURST,
    bAt: now,
  });
  ensureTick();
  broadcast({ t: 'join', id, color }, id);
  countDirty = true; // coalesced into the next tick
  res.write(`data: ${JSON.stringify({ t: 'count', n: peers.size })}\n\n`);

  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    peers.delete(id);
    pendingCursors.delete(id);
    broadcast({ t: 'leave', id });
    countDirty = true;
  });
}

function presenceEvent(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 4096) req.destroy();
  });
  req.on('end', () => {
    try {
      const msg = JSON.parse(body);
      const id = String(msg.id);
      const peer = peers.get(id);
      if (!peer || peer.token !== msg.token) {
        res.writeHead(204).end();
        return;
      }
      const now = Date.now();

      switch (msg.t) {
        case 'cursor': {
          const realtime = peers.size <= REALTIME_MAX;
          const floor = realtime ? CURSOR_MIN_RT_MS : CURSOR_MIN_MS;
          if (now - peer.cursorAt < floor) break; // over the floor: drop
          peer.cursorAt = now;
          const entry = { a: msg.a, fx: msg.fx, fy: msg.fy };
          peer.lastEvent = { id, t: 'cursor', ...entry };
          if (realtime) {
            // Small room: fan-out is cheap, latency is what matters.
            broadcast({ t: 'cursor', id, ...entry, color: peer.color }, id);
          } else {
            pendingCursors.set(id, entry); // coalesced — the tick fans out
          }
          break;
        }
        case 'bullet': {
          // Refill, then spend a token; drop silently when dry or over the
          // global budget. Senders still see their own bullet locally.
          const refill = Math.floor((now - peer.bAt) / BULLET_REFILL_MS);
          if (refill > 0) {
            peer.bTokens = Math.min(BULLET_BURST, peer.bTokens + refill);
            peer.bAt = now;
          }
          if (peer.bTokens <= 0 || !bulletBudgetOk(now)) break;
          peer.bTokens--;
          if (typeof msg.text !== 'string' || !msg.text) break;
          broadcast({ t: 'bullet', id, text: msg.text.slice(0, 120), color: peer.color }, id);
          break;
        }
        case 'focus':
        case 'loc': {
          // A swallowed CLEAR leaves a ghost dot on everyone's cards — only
          // sets are rate-floored; clears always pass.
          const isClear = msg.t === 'focus' && !msg.card;
          if (!isClear) {
            if (now - peer.metaAt < META_MIN_MS) break;
            peer.metaAt = now;
          }
          if (msg.t === 'loc') peer.loc = msg.loc || null;
          const { token: _token, ...relay } = msg;
          broadcast({ ...relay, id, color: peer.color }, id);
          break;
        }
        case 'idle': {
          pendingCursors.delete(id);
          broadcast({ t: 'idle', id }, id);
          break;
        }
        case 'spray': {
          // On/off state only (positions ride the cursor channel); own floor
          // so held-spray heartbeats can't be used as a broadcast amplifier.
          if (now - (peer.sprayAt || 0) < 250) break;
          peer.sprayAt = now;
          broadcast({ t: 'spray', id, on: msg.on ? 1 : 0 }, id);
          break;
        }
        case 'like': {
          if (!LIKE_CARDS.has(msg.card) || typeof msg.on !== 'boolean') break;
          if (now - peer.likeAt < LIKE_MIN_MS) break;
          peer.likeAt = now;
          const clients = likesByCard.get(msg.card);
          const had = clients.has(peer.clientId);
          const changed = had !== msg.on;
          if (changed) {
            if (msg.on) clients.add(peer.clientId);
            else clients.delete(peer.clientId);
          }
          publishLike(msg.card, clients.size, peer.clientId, msg.on, changed);
          break;
        }
      }
      res.writeHead(204).end();
    } catch {
      res.writeHead(400).end();
    }
  });
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

function serveStatic(req, res) {
  // Decode defensively: malformed escapes (/%zz) must 400, not throw, and a
  // NUL byte would make fs.stat throw synchronously.
  let rawPath;
  let urlPath;
  try {
    rawPath = new URL(req.url, 'http://x').pathname;
    urlPath = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath.includes('\0')) {
    res.writeHead(400).end();
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  // Resolve AFTER decoding (an encoded %2f survives URL normalization), and
  // require a real separator so a sibling like "gallery-backup" can't pass a
  // bare prefix check.
  const filePath = path.resolve(ROOT, '.' + urlPath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // Directory without trailing slash -> its index.html. The redirect
      // target is built from the still-encoded pathname, never decoded input.
      const indexPath = path.join(filePath, 'index.html');
      if (!err && stat.isDirectory() && fs.existsSync(indexPath)) {
        res.writeHead(302, { Location: rawPath + '/' }).end();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

http
  .createServer((req, res) => {
    if (req.url.startsWith('/presence/stream')) return presenceStream(req, res);
    if (req.url.startsWith('/presence/event') && req.method === 'POST') return presenceEvent(req, res);
    return serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`zanwei's playground → http://localhost:${PORT}`);
  });
