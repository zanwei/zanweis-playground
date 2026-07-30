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
const TICK_CHAT_CAP = 20; // chat snapshots are larger than cursor entries
const CURSOR_MIN_MS = 30; // per-peer cursor ingest floor when crowded
const CURSOR_MIN_RT_MS = 15; // ~66Hz ceiling in the realtime tier
const META_MIN_MS = 900; // per-peer focus/loc ingest floor
const CHAT_TTL_MS = 5000;
const CHAT_SESSION_HISTORY_CAP = 64;
const CHAT_SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CHAT_ANCHOR_RE = /^(?:page|(?:card|shell):[A-Za-z0-9_-]{1,64})$/;
const CHAT_RATE_PER_SEC = 25;
const CHAT_RATE_BURST = 8;
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
  'shoedex-sign-in',
  'shoedex-scan-button',
  'whiteboard-1',
  'whiteboard-2',
  'whiteboard-3',
  'whiteboard-4',
]);
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function parseChatMessage(msg) {
  if (
    typeof msg.session !== 'string' ||
    !CHAT_SESSION_RE.test(msg.session) ||
    !Number.isSafeInteger(msg.seq) ||
    msg.seq <= 0 ||
    typeof msg.text !== 'string'
  ) {
    return null;
  }

  const text = Array.from(msg.text.replace(/[\u0000-\u001F\u007F]/g, ''))
    .slice(0, 120)
    .join('');
  if (!text.trim()) return { session: msg.session, seq: msg.seq, text: '' };
  if (
    typeof msg.a !== 'string' ||
    !CHAT_ANCHOR_RE.test(msg.a) ||
    !Number.isFinite(msg.fx) ||
    !Number.isFinite(msg.fy) ||
    !Number.isFinite(msg.ttlMs)
  ) {
    return null;
  }

  return {
    session: msg.session,
    seq: msg.seq,
    text,
    a: msg.a,
    fx: msg.fx,
    fy: msg.fy,
    ttlMs: Math.max(1, Math.min(CHAT_TTL_MS, Math.floor(msg.ttlMs))),
  };
}

function chatEntry(user, chat, now = Date.now()) {
  if (!chat) return null;
  const ttlMs = Math.min(CHAT_TTL_MS, Math.ceil(chat.expiresAt - now));
  if (ttlMs <= 0) return null;
  return {
    id: user.id,
    rev: chat.rev,
    text: chat.text,
    a: chat.a,
    fx: chat.fx,
    fy: chat.fy,
    color: user.color,
    ttlMs,
  };
}

function chatRosterEntry(user, now = Date.now()) {
  const entry = chatEntry(user, user.chat, now);
  if (!entry) return null;
  const { id: _id, color: _color, ...snapshot } = entry;
  return snapshot;
}

/**
 * Server-side presence is keyed by a private stable client id, while the room
 * protocol exposes only a temporary public id. A user may temporarily own
 * several transport connections (refresh overlap, EventSource reconnect, or
 * multiple tabs), but appears once in rosters and counts.
 *
 * token -> { res, token, user }
 * private client id -> { clientId, id: temporary public id, color,
 *                        connections, lastEvent, loc, rate-limit state }
 */
const connections = new Map();
const users = new Map();
let activitySequence = 0;
/** card slug -> stable anonymous client IDs that currently like it. */
const likesByCard = new Map([...LIKE_CARDS].map((card) => [card, new Set()]));

function isRealtimeRoom() {
  return users.size <= REALTIME_MAX && connections.size <= REALTIME_MAX;
}

function colorForPublicId(publicId) {
  let hash = 2166136261;
  for (let i = 0; i < publicId.length; i++) {
    hash ^= publicId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return CURSOR_COLORS[(hash >>> 0) % CURSOR_COLORS.length];
}

function newPublicId() {
  let id;
  do {
    // "." is deliberately outside CLIENT_ID_RE, so a public room id can
    // never be replayed as the private ?client= aggregation credential.
    id = `p.${crypto.randomUUID()}`;
  } while ([...users.values()].some((user) => user.id === id));
  return id;
}

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

function connectionRecords(user) {
  const records = [];
  for (const token of user.connections) {
    const connection = connections.get(token);
    if (connection) records.push(connection);
  }
  return records;
}

function acceptChatSequence(connection, session, seq) {
  const previous = connection.chatSeqs.get(session) || 0;
  if (seq <= previous) return false;
  connection.chatSeqs.set(session, seq);
  while (connection.chatSeqs.size > CHAT_SESSION_HISTORY_CAP) {
    const oldest = connection.chatSeqs.keys().next().value;
    if (oldest === connection.chat?.session) {
      const activeSeq = connection.chatSeqs.get(oldest);
      connection.chatSeqs.delete(oldest);
      connection.chatSeqs.set(oldest, activeSeq);
      continue;
    }
    connection.chatSeqs.delete(oldest);
  }
  return true;
}

function supersedeConnectionChat(connection) {
  if (!connection.chat) return;
  connection.supersededChatSessions.add(connection.chat.session);
  connection.chat = null;
  while (connection.supersededChatSessions.size > CHAT_SESSION_HISTORY_CAP) {
    connection.supersededChatSessions.delete(
      connection.supersededChatSessions.values().next().value
    );
  }
}

function chatBudgetOk(connection, now) {
  const elapsed = Math.max(0, now - connection.chatTokenAt);
  connection.chatTokens = Math.min(
    CHAT_RATE_BURST,
    connection.chatTokens + (elapsed * CHAT_RATE_PER_SEC) / 1000
  );
  connection.chatTokenAt = now;
  if (connection.chatTokens < 1) return false;
  connection.chatTokens -= 1;
  return true;
}

function publishChat(user, chat, now = Date.now()) {
  const entry = chatEntry(user, chat, now);
  if (!entry) return;
  if (isRealtimeRoom()) {
    pendingChats.delete(user.id);
    broadcast({ t: 'chat', ...entry }, user.id);
  } else {
    pendingChats.set(user.id, { ...entry, expiresAt: chat.expiresAt });
  }
}

function clearOwnedChat(user, connection, session = null) {
  const current = user.chat;
  if (
    !current ||
    current.owner !== connection ||
    (session !== null && current.session !== session)
  ) {
    if (connection.chat?.session === session) connection.chat = null;
    return false;
  }

  connection.chat = null;
  user.chat = null;
  pendingChats.delete(user.id);
  const rev = ++activitySequence;
  broadcast(
    {
      t: 'chat',
      id: user.id,
      rev,
      text: '',
      a: current.a,
      fx: current.fx,
      fy: current.fy,
      color: user.color,
      ttlMs: 0,
    },
    user.id
  );
  return true;
}

function applyChat(user, connection, parsed, now) {
  if (!acceptChatSequence(connection, parsed.session, parsed.seq)) return;
  if (connection.supersededChatSessions.has(parsed.session)) return;

  if (!parsed.text) {
    clearOwnedChat(user, connection, parsed.session);
    return;
  }
  if (!isRealtimeRoom() && !chatBudgetOk(connection, now)) return;

  // One public user owns one cursor-chat bubble. Superseded sibling state is
  // cleared so a later close or hibernation restore cannot resurrect it.
  for (const record of connectionRecords(user)) {
    if (record.chat && (record !== connection || record.chat.session !== parsed.session)) {
      supersedeConnectionChat(record);
    }
  }

  const chat = {
    session: parsed.session,
    rev: ++activitySequence,
    text: parsed.text,
    a: parsed.a,
    fx: parsed.fx,
    fy: parsed.fy,
    expiresAt: now + parsed.ttlMs,
  };
  connection.chat = chat;
  connection.idle = false;
  user.chat = { ...chat, owner: connection };
  user.idle = false;
  publishChat(user, user.chat, now);
}

function syncUserState(user) {
  const records = connectionRecords(user);

  let latestCursor = null;
  let latestCursorSeq = -1;
  let nextFocus = null;
  let nextFocusSeq = -1;
  let nextSpray = false;
  for (const connection of records) {
    if (!connection.idle && connection.lastEvent && connection.cursorSeq > latestCursorSeq) {
      latestCursor = connection.lastEvent;
      latestCursorSeq = connection.cursorSeq;
    }
    if (connection.focus && connection.focusSeq > nextFocusSeq) {
      nextFocus = connection.focus;
      nextFocusSeq = connection.focusSeq;
    }
    if (connection.spray) nextSpray = true;
  }

  const nextIdle = records.every((connection) => connection.idle);
  if (latestCursor !== user.lastEvent) {
    user.lastEvent = latestCursor;
    pendingCursors.delete(user.id);
    if (latestCursor) {
      broadcast({ ...latestCursor, color: user.color }, user.id);
    }
  }
  if (nextIdle && !user.idle) {
    user.lastEvent = null;
    pendingCursors.delete(user.id);
    broadcast({ t: 'idle', id: user.id }, user.id);
  }
  user.idle = nextIdle;

  if (nextFocus !== user.focus) {
    user.focus = nextFocus;
    broadcast({ t: 'focus', id: user.id, card: nextFocus, color: user.color }, user.id);
  }
  if (nextSpray !== user.spray) {
    user.spray = nextSpray;
    broadcast({ t: 'spray', id: user.id, on: nextSpray ? 1 : 0 }, user.id);
  }
}

function dropConnection(token, connection, destroy = false) {
  // close/error can arrive more than once, and an old connection can close
  // after a replacement is already live. Only remove this exact connection.
  if (connections.get(token) !== connection) return;
  const queued = pendingConnectionDrops.get(token);
  if (queued?.connection === connection) pendingConnectionDrops.delete(token);
  connections.delete(token);

  const { user } = connection;
  user.connections.delete(token);
  clearOwnedChat(user, connection);
  if (destroy) {
    try {
      connection.res.destroy();
    } catch {
      /* already gone */
    }
  }

  if (user.connections.size > 0) {
    syncUserState(user);
    return;
  }

  // A user leaves only with their final connection. The object-identity guard
  // prevents a delayed close from deleting a newly created generation.
  if (users.get(user.clientId) !== user) return;
  users.delete(user.clientId);
  pendingCursors.delete(user.id);
  pendingChats.delete(user.id);
  if (user.spray) broadcast({ t: 'spray', id: user.id, on: 0 }, user.id);
  broadcast({ t: 'leave', id: user.id });
  countDirty = true;
}

const pendingConnectionDrops = new Map();
let connectionDropFlushScheduled = false;
let flushingConnectionDrops = false;

function queueConnectionDrop(token, connection) {
  if (connections.get(token) !== connection) return;
  const queued = pendingConnectionDrops.get(token);
  if (queued?.connection === connection) return;
  pendingConnectionDrops.set(token, { connection });
  if (flushingConnectionDrops || connectionDropFlushScheduled) return;
  connectionDropFlushScheduled = true;
  queueMicrotask(flushConnectionDrops);
}

function flushConnectionDrops() {
  connectionDropFlushScheduled = false;
  if (flushingConnectionDrops) return;
  flushingConnectionDrops = true;
  try {
    while (pendingConnectionDrops.size) {
      const [token, queued] = pendingConnectionDrops.entries().next().value;
      pendingConnectionDrops.delete(token);
      dropConnection(token, queued.connection, true);
    }
  } finally {
    flushingConnectionDrops = false;
    if (pendingConnectionDrops.size && !connectionDropFlushScheduled) {
      connectionDropFlushScheduled = true;
      queueMicrotask(flushConnectionDrops);
    }
  }
}

function broadcast(payload, exceptUserId) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [token, connection] of connections) {
    if (connection.user.id === exceptUserId) continue;
    if (pendingConnectionDrops.get(token)?.connection === connection) continue;
    // A consumer that stopped reading would buffer this process into the
    // ground — cut it loose; its EventSource reconnects when it recovers.
    if (connection.res.writableLength > SLOW_LIMIT) {
      queueConnectionDrop(token, connection);
      continue;
    }
    try {
      connection.res.write(line);
      if (connection.res.writableLength > SLOW_LIMIT) {
        queueConnectionDrop(token, connection);
      }
    } catch {
      queueConnectionDrop(token, connection);
    }
  }
}

// Like SETs are acknowledged immediately to every live tab sharing the
// actor's stable client ID. Changed counts join the 50 ms tick below so a
// burst costs one room-wide frame instead of one fanout per event.
function publishLike(card, count, clientId, on, changed) {
  if (changed) pendingLikeCounts.set(card, count);
  for (const [token, connection] of connections) {
    if (connection.user.clientId !== clientId) continue;
    if (pendingConnectionDrops.get(token)?.connection === connection) continue;
    if (connection.res.writableLength > SLOW_LIMIT) {
      queueConnectionDrop(token, connection);
      continue;
    }
    try {
      connection.res.write(
        `data: ${JSON.stringify({ t: 'like', card, count, on })}\n\n`
      );
      if (connection.res.writableLength > SLOW_LIMIT) {
        queueConnectionDrop(token, connection);
      }
    } catch {
      queueConnectionDrop(token, connection);
    }
  }
}

// --- room tick: coalesced cursors, chats, and like counts, flushed as frames

const pendingCursors = new Map(); // id -> { a, fx, fy }
const pendingChats = new Map(); // id -> latest unexpired chat snapshot
const pendingLikeCounts = new Map(); // card -> latest authoritative count
let countDirty = false;
let tickTimer = null;

function tick() {
  if (connections.size === 0) {
    clearInterval(tickTimer);
    tickTimer = null;
    pendingCursors.clear();
    pendingChats.clear();
    pendingLikeCounts.clear();
    return;
  }
  if (countDirty) {
    countDirty = false;
    broadcast({ t: 'count', n: users.size });
  }
  if (pendingLikeCounts.size) {
    const counts = Object.fromEntries(pendingLikeCounts);
    pendingLikeCounts.clear();
    broadcast({ t: 'likes', counts });
  }
  if (pendingChats.size) {
    const now = Date.now();
    const list = [];
    for (const [id, chat] of pendingChats) {
      pendingChats.delete(id);
      const ttlMs = Math.min(CHAT_TTL_MS, Math.ceil(chat.expiresAt - now));
      if (ttlMs > 0) {
        const { expiresAt: _expiresAt, ...entry } = chat;
        list.push({ ...entry, ttlMs });
      }
      if (list.length >= TICK_CHAT_CAP) break;
    }
    if (list.length) broadcast({ t: 'chats', list });
  }
  if (pendingCursors.size) {
    const list = [];
    for (const [id, c] of pendingCursors) {
      list.push({ id, a: c.a, fx: c.fx, fy: c.fy, color: c.color });
      pendingCursors.delete(id);
      if (list.length >= TICK_CURSOR_CAP) break; // the rest ride the next tick
    }
    if (list.length) broadcast({ t: 'cursors', list });
  }
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
  if (connections.size >= MAX_PEERS) {
    // Full house. The client's EventSource fails before "hello" and falls
    // back to tab-local presence — the page keeps working.
    res.writeHead(503, { 'Retry-After': '30' }).end();
    return;
  }

  const clientId = clientIdFor(req);
  // The POST channel proves identity with this token, so one visitor can't
  // puppeteer another's cursor by copying their stable public id.
  const token = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  let user = users.get(clientId);
  const isNewUser = !user;
  if (!user) {
    const publicId = newPublicId();
    user = {
      clientId,
      id: publicId,
      color: colorForPublicId(publicId),
      connections: new Set(),
      lastEvent: null,
      loc: null,
      idle: true,
      focus: null,
      spray: false,
      chat: null,
      likeAt: 0,
      bTokens: BULLET_BURST,
      bAt: now,
    };
    users.set(clientId, user);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Tell the newcomer who they are and who is already here. The detailed
  // snapshot caps out — beyond it the count alone tells the story.
  const roster = [];
  for (const [otherClientId, other] of users) {
    if (otherClientId === clientId) continue;
    if (roster.length >= ROSTER_CAP) break;
    roster.push({
      id: other.id,
      color: other.color,
      last: other.lastEvent || null,
      loc: other.loc || null,
      chat: chatRosterEntry(other, now),
    });
  }

  const connection = {
    res,
    token,
    user,
    idle: true,
    lastEvent: null,
    cursorSeq: 0,
    cursorAt: 0,
    focus: null,
    focusSeq: 0,
    focusRateAt: 0,
    locAt: 0,
    spray: false,
    sprayAt: 0,
    chat: null,
    chatSeqs: new Map(),
    supersededChatSessions: new Set(),
    chatTokens: CHAT_RATE_BURST,
    chatTokenAt: now,
  };
  connections.set(token, connection);
  user.connections.add(token);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  res.once('close', () => {
    clearInterval(ping);
    dropConnection(token, connection);
  });

  res.write(
    `data: ${JSON.stringify({
      t: 'hello',
      id: user.id,
      color: user.color,
      token,
      peers: roster,
      likes: likesSnapshot(clientId),
    })}\n\n`
  );

  ensureTick();
  if (isNewUser) {
    broadcast({ t: 'join', id: user.id, color: user.color }, user.id);
    countDirty = true; // coalesced into the next tick
  }
  res.write(`data: ${JSON.stringify({ t: 'count', n: users.size })}\n\n`);
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
      const connection = connections.get(String(msg.token || ''));
      const user = connection?.user;
      if (!user || user.id !== id) {
        res.writeHead(204).end();
        return;
      }
      const now = Date.now();

      switch (msg.t) {
        case 'cursor': {
          const realtime = isRealtimeRoom();
          const floor = realtime ? CURSOR_MIN_RT_MS : CURSOR_MIN_MS;
          if (now - connection.cursorAt < floor) break; // over the floor: drop
          connection.cursorAt = now;
          const entry = { a: msg.a, fx: msg.fx, fy: msg.fy };
          const event = { id, t: 'cursor', ...entry };
          connection.idle = false;
          connection.lastEvent = event;
          connection.cursorSeq = ++activitySequence;
          user.idle = false;
          user.lastEvent = event;
          if (realtime) {
            // Small room: fan-out is cheap, latency is what matters.
            pendingCursors.delete(id);
            broadcast({ t: 'cursor', id, ...entry, color: user.color }, id);
          } else {
            pendingCursors.set(id, { ...entry, color: user.color }); // coalesced
          }
          break;
        }
        case 'bullet': {
          // Refill, then spend a token; drop silently when dry or over the
          // global budget. Senders still see their own bullet locally.
          const refill = Math.floor((now - user.bAt) / BULLET_REFILL_MS);
          if (refill > 0) {
            user.bTokens = Math.min(BULLET_BURST, user.bTokens + refill);
            user.bAt = now;
          }
          if (user.bTokens <= 0 || !bulletBudgetOk(now)) break;
          user.bTokens--;
          if (typeof msg.text !== 'string' || !msg.text) break;
          broadcast({ t: 'bullet', id, text: msg.text.slice(0, 120), color: user.color }, id);
          break;
        }
        case 'chat': {
          const parsed = parseChatMessage(msg);
          if (!parsed) break;
          applyChat(user, connection, parsed, now);
          break;
        }
        case 'focus':
        case 'loc': {
          // A swallowed CLEAR leaves a ghost dot on everyone's cards — only
          // sets are rate-floored; clears always pass.
          const isClear = msg.t === 'focus' && !msg.card;
          if (!isClear) {
            const rateKey = msg.t === 'focus' ? 'focusRateAt' : 'locAt';
            if (now - connection[rateKey] < META_MIN_MS) break;
            connection[rateKey] = now;
          }
          if (msg.t === 'focus') {
            connection.focus = msg.card || null;
            connection.focusSeq = ++activitySequence;
            syncUserState(user);
          } else {
            user.loc = msg.loc || null;
            broadcast({ t: 'loc', loc: user.loc, id, color: user.color }, id);
          }
          break;
        }
        case 'idle': {
          clearOwnedChat(user, connection);
          if (!connection.idle) {
            connection.idle = true;
            syncUserState(user);
          }
          break;
        }
        case 'spray': {
          // On/off state only (positions ride the cursor channel); own floor
          // so held-spray heartbeats can't be used as a broadcast amplifier.
          if (now - connection.sprayAt < 250) break;
          connection.sprayAt = now;
          connection.spray = !!msg.on;
          syncUserState(user);
          break;
        }
        case 'like': {
          if (!LIKE_CARDS.has(msg.card) || typeof msg.on !== 'boolean') break;
          if (now - user.likeAt < LIKE_MIN_MS) break;
          user.likeAt = now;
          const clients = likesByCard.get(msg.card);
          const had = clients.has(user.clientId);
          const changed = had !== msg.on;
          if (changed) {
            if (msg.on) clients.add(user.clientId);
            else clients.delete(user.clientId);
          }
          publishLike(msg.card, clients.size, user.clientId, msg.on, changed);
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

function parseSingleByteRange(header, size) {
  if (typeof header !== 'string' || size === 0) return null;

  // Deliberately reject multipart ranges. The local server only needs the
  // single-range behavior used by media elements, and treating unsupported
  // range syntax as unsatisfiable keeps responses deterministic.
  const match = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
    };
  }

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start >= size) return null;

  if (!match[2]) return { start, end: size - 1 };

  const requestedEnd = Number(match[2]);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

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
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
    };
    const isHead = req.method === 'HEAD';
    const rangeHeader =
      (req.method === 'GET' || isHead) ? req.headers.range : undefined;

    if (rangeHeader !== undefined) {
      const range = parseSingleByteRange(rangeHeader, stat.size);
      if (!range) {
        res.writeHead(416, {
          ...headers,
          'Content-Range': `bytes */${stat.size}`,
          'Content-Length': 0,
        }).end();
        return;
      }

      const contentLength = range.end - range.start + 1;
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Content-Length': contentLength,
      });
      if (isHead) {
        res.end();
        return;
      }
      fs.createReadStream(filePath, range).pipe(res);
      return;
    }

    res.writeHead(200, {
      ...headers,
      'Content-Length': stat.size,
    });
    if (isHead) {
      res.end();
      return;
    }
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
