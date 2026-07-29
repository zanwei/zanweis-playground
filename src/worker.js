/**
 * zanwei's playground — Cloudflare Worker.
 *
 * Static files ship via Workers Assets; the presence layer lives in one
 * Durable Object room speaking WebSocket. (SSE is what `node server.js`
 * speaks locally — in workerd, cross-request stream writes hang inside
 * request IoContexts, while WebSocket sends are explicitly context-free,
 * so the Worker uses the primitive the platform blesses. The client tries
 * WS first, then SSE, then BroadcastChannel.)
 *
 * Message protocol and scale guards mirror server.js exactly.
 */
'use strict';

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/presence/ws') {
      return env.PRESENCE.get(env.PRESENCE.idFromName('lobby')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

const CURSOR_COLORS = ['orange', 'violet', 'green', 'pink', 'blue', 'amber'];

const MAX_PEERS = 1200;
const REALTIME_MAX = 12; // small rooms relay per-event, live
const TICK_MS = 50;
const TICK_CURSOR_CAP = 40;
const CURSOR_MIN_MS = 30;
const CURSOR_MIN_RT_MS = 15;
const META_MIN_MS = 900;
const BULLET_BURST = 3;
const BULLET_REFILL_MS = 2500;
const BULLET_GLOBAL_PER_SEC = 25;
const ROSTER_CAP = 200;
const LIKE_MIN_MS = 120;
const LIKE_COUNTS_KEY = 'like-counts:v1';
const LIKE_MEMBERSHIP_PREFIX = 'like:v1:';
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

export class PresenceRoom {
  constructor(state) {
    this.state = state;
    this.peers = new Map(); // ws -> peer record
    this.pendingCursors = new Map(); // id -> { a, fx, fy }
    this.pendingLikeCounts = new Map(); // card -> latest authoritative count
    this.colorCursor = 0;
    this.nextId = 1;
    this.countDirty = false;
    this.tickTimer = null;
    this.bulletWindowStart = 0;
    this.bulletWindowCount = 0;
    this.likeCounts = Object.fromEntries([...LIKE_CARDS].map((card) => [card, 0]));
    this.likesReady = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get(LIKE_COUNTS_KEY);
      if (!stored || typeof stored !== 'object') return;
      for (const card of LIKE_CARDS) {
        const count = stored[card];
        if (Number.isSafeInteger(count) && count >= 0) this.likeCounts[card] = count;
      }
    });
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      this.drop(ws);
    }
  }

  broadcast(payload, exceptWs) {
    const line = JSON.stringify(payload);
    for (const ws of this.peers.keys()) {
      if (ws === exceptWs) continue;
      try {
        ws.send(line);
      } catch {
        this.drop(ws);
      }
    }
  }

  publishLike(card, count, clientId, on, changed) {
    if (changed) this.pendingLikeCounts.set(card, count);
    for (const [ws, peer] of this.peers) {
      if (peer.clientId !== clientId) continue;
      this.send(ws, { t: 'like', card, count, on });
    }
  }

  clientIdFor(request) {
    let candidate = '';
    try {
      candidate = new URL(request.url).searchParams.get('client') || '';
    } catch {
      /* a malformed URL receives a fresh anonymous identity */
    }
    return CLIENT_ID_RE.test(candidate) ? candidate : crypto.randomUUID();
  }

  membershipKey(clientId, card) {
    return `${LIKE_MEMBERSHIP_PREFIX}${clientId}:${card}`;
  }

  async likesSnapshot(clientId) {
    await this.likesReady;
    const prefix = `${LIKE_MEMBERSHIP_PREFIX}${clientId}:`;
    const memberships = await this.state.storage.list({ prefix });
    const mine = [];
    for (const key of memberships.keys()) {
      const card = key.slice(prefix.length);
      if (LIKE_CARDS.has(card)) mine.push(card);
    }
    return { counts: { ...this.likeCounts }, mine };
  }

  async setLike(peer, card, on) {
    const membershipKey = this.membershipKey(peer.clientId, card);
    const result = await this.state.storage.transaction(async (txn) => {
      const had = (await txn.get(membershipKey)) === true;
      const stored = (await txn.get(LIKE_COUNTS_KEY)) || {};
      let count =
        Number.isSafeInteger(stored[card]) && stored[card] >= 0
          ? stored[card]
          : this.likeCounts[card] || 0;
      if (had === on) return { changed: false, count };

      count = Math.max(0, count + (on ? 1 : -1));
      if (on) await txn.put(membershipKey, true);
      else await txn.delete(membershipKey);
      await txn.put(LIKE_COUNTS_KEY, { ...stored, [card]: count });
      return { changed: true, count };
    });

    this.likeCounts[card] = result.count;
    this.publishLike(card, result.count, peer.clientId, on, result.changed);
  }

  drop(ws) {
    const peer = this.peers.get(ws);
    if (!peer) return;
    this.peers.delete(ws);
    this.pendingCursors.delete(peer.id);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.broadcast({ t: 'leave', id: peer.id });
    this.countDirty = true;
  }

  tick() {
    if (this.peers.size === 0) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      this.pendingCursors.clear();
      this.pendingLikeCounts.clear();
      return;
    }
    if (this.countDirty) {
      this.countDirty = false;
      this.broadcast({ t: 'count', n: this.peers.size });
    }
    if (this.pendingLikeCounts.size) {
      const counts = Object.fromEntries(this.pendingLikeCounts);
      this.pendingLikeCounts.clear();
      this.broadcast({ t: 'likes', counts });
    }
    if (this.pendingCursors.size === 0) return;
    const list = [];
    for (const [id, c] of this.pendingCursors) {
      list.push({ id, a: c.a, fx: c.fx, fy: c.fy, color: c.color });
      this.pendingCursors.delete(id);
      if (list.length >= TICK_CURSOR_CAP) break;
    }
    if (list.length) this.broadcast({ t: 'cursors', list });
  }

  ensureTick() {
    if (this.tickTimer === null) this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  bulletBudgetOk(now) {
    if (now - this.bulletWindowStart >= 1000) {
      this.bulletWindowStart = now;
      this.bulletWindowCount = 0;
    }
    return ++this.bulletWindowCount <= BULLET_GLOBAL_PER_SEC;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (this.peers.size >= MAX_PEERS) {
      return new Response(null, { status: 503, headers: { 'Retry-After': '30' } });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);

    const id = String(this.nextId++);
    const color = CURSOR_COLORS[this.colorCursor++ % CURSOR_COLORS.length];
    const clientId = this.clientIdFor(request);
    const likes = await this.likesSnapshot(clientId);

    const roster = [];
    for (const p of this.peers.values()) {
      if (roster.length >= ROSTER_CAP) break;
      roster.push({ id: p.id, color: p.color, last: p.lastEvent || null, loc: p.loc || null });
    }

    const now = Date.now();
    this.peers.set(server, {
      id,
      color,
      clientId,
      lastEvent: null,
      loc: null,
      cursorAt: 0,
      metaAt: 0,
      likeAt: 0,
      sprayAt: 0,
      bTokens: BULLET_BURST,
      bAt: now,
    });
    this.ensureTick();

    this.send(server, { t: 'hello', id, color, clientId, peers: roster, likes });
    this.broadcast({ t: 'join', id, color }, server);
    this.countDirty = true;
    this.send(server, { t: 'count', n: this.peers.size });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const peer = this.peers.get(ws);
    if (!peer || typeof raw !== 'string' || raw.length > 4096) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    const id = peer.id;

    switch (msg.t) {
      case 'cursor': {
        const realtime = this.peers.size <= REALTIME_MAX;
        const floor = realtime ? CURSOR_MIN_RT_MS : CURSOR_MIN_MS;
        if (now - peer.cursorAt < floor) break;
        peer.cursorAt = now;
        const entry = { a: msg.a, fx: msg.fx, fy: msg.fy };
        peer.lastEvent = { id, t: 'cursor', ...entry };
        if (realtime) {
          this.broadcast({ t: 'cursor', id, ...entry, color: peer.color }, ws);
        } else {
          this.pendingCursors.set(id, { ...entry, color: peer.color });
        }
        break;
      }
      case 'bullet': {
        const refill = Math.floor((now - peer.bAt) / BULLET_REFILL_MS);
        if (refill > 0) {
          peer.bTokens = Math.min(BULLET_BURST, peer.bTokens + refill);
          peer.bAt = now;
        }
        if (peer.bTokens <= 0 || !this.bulletBudgetOk(now)) break;
        peer.bTokens--;
        if (typeof msg.text !== 'string' || !msg.text) break;
        this.broadcast({ t: 'bullet', id, text: msg.text.slice(0, 120), color: peer.color }, ws);
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
        const relay = msg.t === 'focus' ? { t: 'focus', card: msg.card || null } : { t: 'loc', loc: peer.loc };
        this.broadcast({ ...relay, id, color: peer.color }, ws);
        break;
      }
      case 'spray': {
        if (now - peer.sprayAt < 250) break;
        peer.sprayAt = now;
        this.broadcast({ t: 'spray', id, on: msg.on ? 1 : 0 }, ws);
        break;
      }
      case 'idle': {
        this.pendingCursors.delete(id);
        this.broadcast({ t: 'idle', id }, ws);
        break;
      }
      case 'like': {
        if (!LIKE_CARDS.has(msg.card) || typeof msg.on !== 'boolean') break;
        if (now - peer.likeAt < LIKE_MIN_MS) break;
        peer.likeAt = now;
        await this.setLike(peer, msg.card, msg.on);
        break;
      }
    }
  }

  webSocketClose(ws) {
    this.drop(ws);
  }

  webSocketError(ws) {
    this.drop(ws);
  }
}
