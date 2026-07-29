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

import { WorkerEntrypoint } from 'cloudflare:workers';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/presence/ws') {
      return env.PRESENCE.get(env.PRESENCE.idFromName('lobby')).fetch(request);
    }
    if (pathname.startsWith('/assets/video/') && pathname.endsWith('.webm')) {
      const response = await ctx.exports.VideoAsset.fetch(request);
      if (!['GET', 'HEAD'].includes(request.method)) return response;

      // Workers Cache creates 206/416 responses after the named entrypoint
      // returns its cacheable 200. Restore the capability header at this
      // uncached gateway layer because the slicing layer does not retain it.
      const headers = new Headers(response.headers);
      headers.set('Accept-Ranges', 'bytes');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return env.ASSETS.fetch(request);
  },
};

export class VideoAsset extends WorkerEntrypoint {
  async fetch(request) {
    const response = await this.env.ASSETS.fetch(request);
    if (!response.ok || !['GET', 'HEAD'].includes(request.method)) return response;

    const headers = new Headers(response.headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

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
const PUBLIC_ID_RE = /^p\.[0-9a-f-]{36}$/i;

function colorForPublicId(publicId) {
  let hash = 2166136261;
  for (let i = 0; i < publicId.length; i++) {
    hash ^= publicId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return CURSOR_COLORS[(hash >>> 0) % CURSOR_COLORS.length];
}

export class PresenceRoom {
  constructor(state) {
    this.state = state;
    this.peers = new Map(); // ws -> { user }
    this.users = new Map(); // stable client id -> aggregate user record
    this.closedSockets = new WeakSet();
    this.pendingCursors = new Map(); // id -> { a, fx, fy }
    this.pendingLikeCounts = new Map(); // card -> latest authoritative count
    this.countDirty = false;
    this.tickTimer = null;
    this.activitySequence = 0;
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

    // acceptWebSocket() is hibernatable: Cloudflare may reconstruct this
    // object while sockets stay connected. Rebuild the unique-user index from
    // per-socket attachments so later close events can still clean up safely.
    for (const ws of this.state.getWebSockets?.() || []) {
      let attachment;
      try {
        attachment = ws.deserializeAttachment();
      } catch {
        attachment = null;
      }
      const clientId = attachment?.clientId;
      const userId = attachment?.userId;
      if (
        !CLIENT_ID_RE.test(clientId || '') ||
        !PUBLIC_ID_RE.test(userId || '') ||
        (this.users.has(clientId) && this.users.get(clientId).id !== userId) ||
        (!this.users.has(clientId) && this.publicIdInUse(userId))
      ) {
        this.closedSockets.add(ws);
        try {
          ws.close(1008, 'invalid presence identity');
        } catch {
          /* already closed */
        }
        continue;
      }
      const user = this.userFor(clientId, userId);
      const restoredStateSeq = Number.isSafeInteger(attachment.stateSeq)
        ? attachment.stateSeq
        : 0;
      if (restoredStateSeq >= user.stateSeq) {
        user.stateSeq = restoredStateSeq;
        user.loc = attachment.loc ?? null;
      }
      const saved = attachment.connection || {};
      const rawLast =
        saved.lastEvent || (saved.idle === false ? attachment.lastEvent : null);
      const savedLast =
        rawLast && rawLast.t === 'cursor'
          ? { ...rawLast, id: user.id }
          : null;
      const connection = {
        user,
        idle: saved.idle !== false,
        lastEvent: savedLast,
        cursorSeq: Number.isSafeInteger(saved.cursorSeq) ? saved.cursorSeq : 0,
        cursorAt: 0,
        focus: typeof saved.focus === 'string' && saved.focus ? saved.focus : null,
        focusSeq: Number.isSafeInteger(saved.focusSeq) ? saved.focusSeq : 0,
        focusRateAt: 0,
        locAt: 0,
        spray: !!saved.spray,
        sprayAt: 0,
      };
      this.activitySequence = Math.max(
        this.activitySequence,
        restoredStateSeq,
        connection.cursorSeq,
        connection.focusSeq
      );
      user.connections.add(ws);
      this.peers.set(ws, connection);
    }
    for (const user of this.users.values()) this.syncUserState(user, false);
  }

  publicIdInUse(publicId) {
    for (const user of this.users.values()) {
      if (user.id === publicId) return true;
    }
    return false;
  }

  newPublicId() {
    let id;
    do {
      // Public ids occupy a namespace CLIENT_ID_RE rejects, so observing one
      // never reveals a value that can be replayed as ?client=.
      id = `p.${crypto.randomUUID()}`;
    } while (this.publicIdInUse(id));
    return id;
  }

  userFor(clientId, restoredPublicId = null) {
    let user = this.users.get(clientId);
    if (user) return user;
    const publicId = restoredPublicId || this.newPublicId();
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
      stateSeq: 0,
      likeAt: 0,
      bTokens: BULLET_BURST,
      bAt: Date.now(),
    };
    this.users.set(clientId, user);
    return user;
  }

  persistUser(user) {
    for (const ws of user.connections) {
      const connection = this.peers.get(ws);
      if (!connection) continue;
      try {
        ws.serializeAttachment({
          clientId: user.clientId,
          userId: user.id,
          stateSeq: user.stateSeq,
          loc: user.loc,
          lastEvent: user.lastEvent,
          idle: user.idle,
          focus: user.focus,
          spray: user.spray,
          connection: {
            idle: connection.idle,
            lastEvent: connection.lastEvent,
            cursorSeq: connection.cursorSeq,
            focus: connection.focus,
            focusSeq: connection.focusSeq,
            spray: connection.spray,
          },
        });
      } catch {
        /* the live socket remains usable; the next state change retries */
      }
    }
  }

  connectionRecords(user) {
    const records = [];
    for (const ws of user.connections) {
      const connection = this.peers.get(ws);
      if (connection) records.push(connection);
    }
    return records;
  }

  syncUserState(user, broadcastChanges = true) {
    const records = this.connectionRecords(user);
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
      this.pendingCursors.delete(user.id);
      if (broadcastChanges && latestCursor) {
        this.broadcast({ ...latestCursor, color: user.color }, user.id);
      }
    }
    if (nextIdle && !user.idle) {
      user.lastEvent = null;
      this.pendingCursors.delete(user.id);
      if (broadcastChanges) this.broadcast({ t: 'idle', id: user.id }, user.id);
    }
    user.idle = nextIdle;

    if (nextFocus !== user.focus) {
      user.focus = nextFocus;
      if (broadcastChanges) {
        this.broadcast(
          { t: 'focus', id: user.id, card: nextFocus, color: user.color },
          user.id
        );
      }
    }
    if (nextSpray !== user.spray) {
      user.spray = nextSpray;
      if (broadcastChanges) {
        this.broadcast({ t: 'spray', id: user.id, on: nextSpray ? 1 : 0 }, user.id);
      }
    }
    this.cancelTickIfIdle();
  }

  reconcileDetachedClose(current) {
    // Attachments are persisted best-effort and may describe state older than
    // what remote peers last rendered. A detached close is rare, so publish a
    // complete current aggregate snapshot unconditionally instead of trusting
    // a stale delta: these SET-like messages are idempotent.
    const currentLast = !current.idle ? current.lastEvent : null;
    this.pendingCursors.delete(current.id);
    if (currentLast) {
      this.broadcast({ ...currentLast, color: current.color }, current.id);
    } else {
      this.broadcast({ t: 'idle', id: current.id }, current.id);
    }
    this.broadcast(
      { t: 'focus', id: current.id, card: current.focus, color: current.color },
      current.id
    );
    this.broadcast(
      { t: 'spray', id: current.id, on: current.spray ? 1 : 0 },
      current.id
    );
    this.cancelTickIfIdle();
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      this.drop(ws);
    }
  }

  broadcast(payload, exceptUserId) {
    const line = JSON.stringify(payload);
    for (const [ws, connection] of this.peers) {
      if (connection.user.id === exceptUserId) continue;
      try {
        ws.send(line);
      } catch {
        this.drop(ws);
      }
    }
  }

  publishLike(card, count, clientId, on, changed) {
    if (changed) {
      this.pendingLikeCounts.set(card, count);
      this.ensureTick();
    }
    for (const [ws, connection] of this.peers) {
      if (connection.user.clientId !== clientId) continue;
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

  async setLike(user, card, on) {
    const membershipKey = this.membershipKey(user.clientId, card);
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
    this.publishLike(card, result.count, user.clientId, on, result.changed);
  }

  drop(ws) {
    if (this.closedSockets.has(ws)) return;
    this.closedSockets.add(ws);
    const connection = this.peers.get(ws);
    if (!connection) {
      // A close event can be the event that wakes a hibernated object. Some
      // runtimes omit that already-disconnected socket from getWebSockets(),
      // so recover its identity from the attachment solely to retract the old
      // public presence; never touch a newer generation with the same client.
      let attachment;
      try {
        attachment = ws.deserializeAttachment();
      } catch {
        attachment = null;
      }
      const clientId = attachment?.clientId;
      const userId = attachment?.userId;
      if (!CLIENT_ID_RE.test(clientId || '') || !PUBLIC_ID_RE.test(userId || '')) return;
      const current = this.users.get(clientId);
      if (current?.id === userId && current.connections.size > 0) {
        this.reconcileDetachedClose(current);
        return;
      }

      this.pendingCursors.delete(userId);
      if (attachment?.connection?.spray) {
        this.broadcast({ t: 'spray', id: userId, on: 0 }, userId);
      }
      this.broadcast({ t: 'leave', id: userId });
      this.countDirty = true;
      this.ensureTick();
      return;
    }
    this.peers.delete(ws);

    const { user } = connection;
    user.connections.delete(ws);
    try {
      ws.close();
    } catch {
      /* already closed */
    }

    if (user.connections.size > 0) {
      user.stateSeq = ++this.activitySequence;
      this.syncUserState(user);
      this.persistUser(user);
      return;
    }

    // A refresh overlap or sibling tab keeps the stable user alive. The
    // identity guard means a delayed close from an older generation can never
    // delete a newly-created user record with the same private client id.
    if (this.users.get(user.clientId) !== user) return;
    this.users.delete(user.clientId);
    this.pendingCursors.delete(user.id);
    if (user.spray) this.broadcast({ t: 'spray', id: user.id, on: 0 }, user.id);
    this.broadcast({ t: 'leave', id: user.id });
    this.countDirty = true;
    this.ensureTick();
  }

  tick() {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    if (this.peers.size === 0) {
      this.countDirty = false;
      this.pendingCursors.clear();
      this.pendingLikeCounts.clear();
      return;
    }
    if (this.countDirty) {
      this.countDirty = false;
      this.broadcast({ t: 'count', n: this.users.size });
    }
    if (this.pendingLikeCounts.size) {
      const counts = Object.fromEntries(this.pendingLikeCounts);
      this.pendingLikeCounts.clear();
      this.broadcast({ t: 'likes', counts });
    }
    if (this.pendingCursors.size) {
      const list = [];
      for (const [id, c] of this.pendingCursors) {
        list.push({ id, a: c.a, fx: c.fx, fy: c.fy, color: c.color });
        this.pendingCursors.delete(id);
        if (list.length >= TICK_CURSOR_CAP) break;
      }
      if (list.length) this.broadcast({ t: 'cursors', list });
    }
    this.ensureTick();
  }

  ensureTick() {
    if (this.peers.size === 0) {
      if (this.tickTimer !== null) clearTimeout(this.tickTimer);
      this.tickTimer = null;
      this.countDirty = false;
      this.pendingCursors.clear();
      this.pendingLikeCounts.clear();
      return;
    }
    if (this.tickTimer !== null) return;
    if (!this.countDirty && !this.pendingLikeCounts.size && !this.pendingCursors.size) return;
    this.tickTimer = setTimeout(() => this.tick(), TICK_MS);
  }

  cancelTickIfIdle() {
    if (
      this.tickTimer !== null &&
      !this.countDirty &&
      !this.pendingLikeCounts.size &&
      !this.pendingCursors.size
    ) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
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

    const clientId = this.clientIdFor(request);
    const likes = await this.likesSnapshot(clientId);
    const isNewUser = !this.users.has(clientId);
    const user = this.userFor(clientId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);

    const roster = [];
    for (const [otherClientId, other] of this.users) {
      if (otherClientId === clientId) continue;
      if (roster.length >= ROSTER_CAP) break;
      roster.push({
        id: other.id,
        color: other.color,
        last: other.lastEvent || null,
        loc: other.loc || null,
      });
    }

    const connection = {
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
    };
    this.peers.set(server, connection);
    user.connections.add(server);
    this.persistUser(user);

    this.send(server, {
      t: 'hello',
      id: user.id,
      color: user.color,
      peers: roster,
      likes,
    });
    if (isNewUser) {
      this.broadcast({ t: 'join', id: user.id, color: user.color }, user.id);
      this.countDirty = true;
      this.ensureTick();
    }
    this.send(server, { t: 'count', n: this.users.size });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const connection = this.peers.get(ws);
    if (!connection || typeof raw !== 'string' || raw.length > 4096) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    const user = connection.user;
    const id = user.id;

    switch (msg.t) {
      case 'cursor': {
        const realtime = this.users.size <= REALTIME_MAX;
        const floor = realtime ? CURSOR_MIN_RT_MS : CURSOR_MIN_MS;
        if (now - connection.cursorAt < floor) break;
        connection.cursorAt = now;
        const entry = { a: msg.a, fx: msg.fx, fy: msg.fy };
        const event = { id, t: 'cursor', ...entry };
        connection.idle = false;
        connection.lastEvent = event;
        connection.cursorSeq = ++this.activitySequence;
        user.stateSeq = connection.cursorSeq;
        user.idle = false;
        user.lastEvent = event;
        if (realtime) {
          this.pendingCursors.delete(id);
          this.cancelTickIfIdle();
          this.broadcast({ t: 'cursor', id, ...entry, color: user.color }, id);
        } else {
          this.pendingCursors.set(id, { ...entry, color: user.color });
          this.ensureTick();
        }
        this.persistUser(user);
        break;
      }
      case 'bullet': {
        const refill = Math.floor((now - user.bAt) / BULLET_REFILL_MS);
        if (refill > 0) {
          user.bTokens = Math.min(BULLET_BURST, user.bTokens + refill);
          user.bAt = now;
        }
        if (user.bTokens <= 0 || !this.bulletBudgetOk(now)) break;
        user.bTokens--;
        if (typeof msg.text !== 'string' || !msg.text) break;
        this.broadcast({ t: 'bullet', id, text: msg.text.slice(0, 120), color: user.color }, id);
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
          connection.focusSeq = ++this.activitySequence;
          user.stateSeq = connection.focusSeq;
          this.syncUserState(user);
        } else {
          user.stateSeq = ++this.activitySequence;
          user.loc = msg.loc || null;
          this.broadcast({ t: 'loc', loc: user.loc, id, color: user.color }, id);
        }
        this.persistUser(user);
        break;
      }
      case 'spray': {
        if (now - connection.sprayAt < 250) break;
        connection.sprayAt = now;
        connection.spray = !!msg.on;
        user.stateSeq = ++this.activitySequence;
        this.syncUserState(user);
        this.persistUser(user);
        break;
      }
      case 'idle': {
        if (!connection.idle) {
          connection.idle = true;
          user.stateSeq = ++this.activitySequence;
          this.syncUserState(user);
          this.persistUser(user);
        }
        break;
      }
      case 'like': {
        if (!LIKE_CARDS.has(msg.card) || typeof msg.on !== 'boolean') break;
        if (now - user.likeAt < LIKE_MIN_MS) break;
        user.likeAt = now;
        await this.setLike(user, msg.card, msg.on);
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
