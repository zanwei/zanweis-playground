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
const REALTIME_MAX = 12; // small rooms bypass the crowded-room chat limiter
const TICK_MS = 33;
const TICK_CURSOR_CAP = 40;
const TICK_CHAT_CAP = 20;
const TICK_ATTACHMENT_CAP = TICK_CURSOR_CAP + TICK_CHAT_CAP;
const CURSOR_MIN_MS = 30;
const META_MIN_MS = 900;
const CHAT_TTL_MS = 5000;
const CHAT_RATE_PER_SEC = 25;
const CHAT_RATE_BURST = 8;
const CHAT_SESSION_HISTORY_CAP = 64;
const CHAT_SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CHAT_ANCHOR_RE = /^(?:page|(?:card|shell):[A-Za-z0-9_-]{1,64})$/;
const BULLET_BURST = 3;
const BULLET_REFILL_MS = 2500;
const BULLET_GLOBAL_PER_SEC = 25;
const ROSTER_CAP = 200;
const LIKE_MIN_MS = 120;
const LIKE_COUNTS_KEY = 'like-counts:v1';
const LIKE_MEMBERSHIP_PREFIX = 'like:v1:';
const LIKE_CARDS = new Set([
  'connected-filmstrip',
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
const PUBLIC_ID_RE = /^p\.[0-9a-f-]{36}$/i;

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

function restoredChat(raw, now = Date.now()) {
  if (
    !raw ||
    typeof raw.session !== 'string' ||
    !CHAT_SESSION_RE.test(raw.session) ||
    !Number.isSafeInteger(raw.rev) ||
    raw.rev <= 0 ||
    typeof raw.text !== 'string' ||
    typeof raw.a !== 'string' ||
    !CHAT_ANCHOR_RE.test(raw.a) ||
    !Number.isFinite(raw.fx) ||
    !Number.isFinite(raw.fy) ||
    !Number.isFinite(raw.expiresAt) ||
    raw.expiresAt <= now
  ) {
    return null;
  }
  const text = Array.from(raw.text.replace(/[\u0000-\u001F\u007F]/g, ''))
    .slice(0, 120)
    .join('');
  if (!text.trim()) return null;
  return {
    session: raw.session,
    rev: raw.rev,
    text,
    a: raw.a,
    fx: raw.fx,
    fy: raw.fy,
    expiresAt: Math.min(raw.expiresAt, now + CHAT_TTL_MS),
  };
}

function restoredChatSeqs(raw, protectedSession = null) {
  const sequences = new Map();
  if (!Array.isArray(raw)) return sequences;
  for (const entry of raw) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      CHAT_SESSION_RE.test(entry[0]) &&
      Number.isSafeInteger(entry[1]) &&
      entry[1] > 0
    ) {
      sequences.set(entry[0], Math.max(sequences.get(entry[0]) || 0, entry[1]));
    }
  }
  while (sequences.size > CHAT_SESSION_HISTORY_CAP) {
    const oldest = sequences.keys().next().value;
    if (oldest === protectedSession) {
      const activeSeq = sequences.get(oldest);
      sequences.delete(oldest);
      sequences.set(oldest, activeSeq);
      continue;
    }
    sequences.delete(oldest);
  }
  return sequences;
}

function restoredSupersededChatSessions(raw) {
  const sessions = new Set();
  if (!Array.isArray(raw)) return sessions;
  for (const session of raw) {
    if (typeof session === 'string' && CHAT_SESSION_RE.test(session)) {
      sessions.add(session);
      while (sessions.size > CHAT_SESSION_HISTORY_CAP) {
        sessions.delete(sessions.values().next().value);
      }
    }
  }
  return sessions;
}

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
    this.failedSockets = new Set();
    this.failedDropScheduled = false;
    this.pendingCursors = new Map(); // id -> { a, fx, fy }
    this.pendingChats = new Map(); // id -> latest unexpired chat snapshot
    this.pendingLikeCounts = new Map(); // card -> latest authoritative count
    this.pendingAttachmentWrites = new Set(); // ws -> latest in-memory state
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
      const savedChat = restoredChat(saved.chat);
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
        chat: savedChat,
        chatSeqs: restoredChatSeqs(saved.chatSeqs, savedChat?.session),
        supersededChatSessions: restoredSupersededChatSessions(
          saved.chatSupersededSessions
        ),
        chatTokens: CHAT_RATE_BURST,
        chatTokenAt: 0,
        attachmentDirty: false,
      };
      if (savedChat) connection.supersededChatSessions.delete(savedChat.session);
      this.activitySequence = Math.max(
        this.activitySequence,
        restoredStateSeq,
        connection.cursorSeq,
        connection.focusSeq,
        connection.chat?.rev || 0
      );
      user.connections.add(ws);
      this.peers.set(ws, connection);
    }
    for (const user of this.users.values()) {
      this.restoreUserChat(user);
      this.syncUserState(user, false);
      this.persistUser(user, true);
    }
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
      chat: null,
      stateSeq: 0,
      likeAt: 0,
      bTokens: BULLET_BURST,
      bAt: Date.now(),
    };
    this.users.set(clientId, user);
    return user;
  }

  persistConnection(ws, connection = this.peers.get(ws)) {
    if (!connection) return false;
    this.pendingAttachmentWrites.delete(ws);
    const { user } = connection;
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
          chat: connection.chat,
          chatSeqs: [...(connection.chatSeqs || [])],
          chatSupersededSessions: [...(connection.supersededChatSessions || [])],
        },
      });
      connection.attachmentDirty = false;
      return true;
    } catch {
      connection.attachmentDirty = true;
      return false;
    }
  }

  persistUser(user, evictOnFailure = false) {
    for (const ws of user.connections) {
      if (!this.persistConnection(ws) && evictOnFailure) {
        this.queueFailedSocket(ws);
      }
    }
  }

  queueConnectionPersist(ws, connection = this.peers.get(ws)) {
    if (!connection || this.failedSockets.has(ws) || this.closedSockets.has(ws)) return;
    connection.attachmentDirty = true;
    this.pendingAttachmentWrites.add(ws);
    this.ensureTick();
  }

  flushPendingConnectionPersists() {
    let count = 0;
    for (const ws of this.pendingAttachmentWrites) {
      this.pendingAttachmentWrites.delete(ws);
      const connection = this.peers.get(ws);
      if (connection && !this.persistConnection(ws, connection)) {
        this.queueFailedSocket(ws);
      }
      if (++count >= TICK_ATTACHMENT_CAP) break;
    }
  }

  persistChatChanges(user, currentWs, immediate = false) {
    if (immediate) {
      if (!this.persistConnection(currentWs)) this.queueFailedSocket(currentWs);
    } else {
      this.queueConnectionPersist(currentWs);
    }
    for (const ws of user.connections) {
      if (ws === currentWs) continue;
      const connection = this.peers.get(ws);
      // Superseded sibling state is rare and safety-critical: persist it
      // immediately so a hibernation wake can never resurrect the old owner.
      if (
        connection?.attachmentDirty &&
        !this.persistConnection(ws, connection)
      ) {
        this.queueFailedSocket(ws);
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

  chatEntry(user, chat, now = Date.now()) {
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

  chatRosterEntry(user, now = Date.now()) {
    const entry = this.chatEntry(user, user.chat, now);
    if (!entry) return null;
    const { id: _id, color: _color, ...snapshot } = entry;
    return snapshot;
  }

  restoreUserChat(user) {
    const now = Date.now();
    let owner = null;
    let latest = null;
    for (const connection of this.connectionRecords(user)) {
      if (!connection.chat || connection.chat.expiresAt <= now) {
        connection.chat = null;
        continue;
      }
      if (!latest || connection.chat.rev > latest.rev) {
        owner = connection;
        latest = connection.chat;
      }
    }
    for (const connection of this.connectionRecords(user)) {
      if (connection !== owner && connection.chat) this.supersedeConnectionChat(connection);
    }
    user.chat = latest ? { ...latest, owner } : null;
    if (latest) {
      user.stateSeq = Math.max(user.stateSeq, latest.rev);
      this.activitySequence = Math.max(this.activitySequence, latest.rev);
    }
  }

  acceptChatSequence(connection, session, seq) {
    if (!(connection.chatSeqs instanceof Map)) connection.chatSeqs = new Map();
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

  supersedeConnectionChat(connection) {
    if (!connection.chat) return;
    if (!(connection.supersededChatSessions instanceof Set)) {
      connection.supersededChatSessions = new Set();
    }
    connection.supersededChatSessions.add(connection.chat.session);
    connection.chat = null;
    connection.attachmentDirty = true;
    while (connection.supersededChatSessions.size > CHAT_SESSION_HISTORY_CAP) {
      connection.supersededChatSessions.delete(
        connection.supersededChatSessions.values().next().value
      );
    }
  }

  isRealtimeRoom() {
    return (
      this.users.size <= REALTIME_MAX &&
      this.peers.size <= REALTIME_MAX
    );
  }

  chatBudgetOk(connection, now) {
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

  publishChat(user, chat, now = Date.now()) {
    const entry = this.chatEntry(user, chat, now);
    if (!entry) return;
    this.pendingChats.set(user.id, { ...entry, expiresAt: chat.expiresAt });
    this.ensureTick();
  }

  clearOwnedChat(user, connection, session = null) {
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
    this.pendingChats.delete(user.id);
    const rev = ++this.activitySequence;
    user.stateSeq = rev;
    this.broadcast(
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
    this.cancelTickIfIdle();
    return true;
  }

  applyChat(user, connection, parsed, now) {
    if (!this.acceptChatSequence(connection, parsed.session, parsed.seq)) return false;
    if (!(connection.supersededChatSessions instanceof Set)) {
      connection.supersededChatSessions = new Set();
    }
    if (connection.supersededChatSessions.has(parsed.session)) return true;

    if (!parsed.text) {
      this.clearOwnedChat(user, connection, parsed.session);
      return true;
    }
    if (!this.isRealtimeRoom() && !this.chatBudgetOk(connection, now)) {
      return true;
    }

    // One public user owns one cursor-chat bubble. Superseded sibling state is
    // cleared so a later close or hibernation restore cannot resurrect it.
    for (const record of this.connectionRecords(user)) {
      if (record.chat && (record !== connection || record.chat.session !== parsed.session)) {
        this.supersedeConnectionChat(record);
      }
    }

    const chat = {
      session: parsed.session,
      rev: ++this.activitySequence,
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
    user.stateSeq = chat.rev;
    this.publishChat(user, user.chat, now);
    return true;
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
    this.pendingChats.delete(current.id);
    const currentChat = this.chatEntry(current, current.chat);
    if (currentChat) {
      this.broadcast({ t: 'chat', ...currentChat }, current.id);
    } else {
      const rev = ++this.activitySequence;
      current.stateSeq = rev;
      this.broadcast(
        {
          t: 'chat',
          id: current.id,
          rev,
          text: '',
          a: currentLast?.a || 'page',
          fx: currentLast?.fx || 0,
          fy: currentLast?.fy || 0,
          color: current.color,
          ttlMs: 0,
        },
        current.id
      );
    }
    this.persistUser(current, true);
    this.cancelTickIfIdle();
  }

  queueFailedSocket(ws) {
    if (this.closedSockets.has(ws) || this.failedSockets.has(ws)) return;
    this.failedSockets.add(ws);
    this.scheduleFailedSocketDrops();
  }

  scheduleFailedSocketDrops() {
    if (this.failedDropScheduled) return;
    this.failedDropScheduled = true;
    queueMicrotask(() => {
      const failed = [...this.failedSockets];
      for (const failedSocket of failed) this.drop(failedSocket);
      for (const failedSocket of failed) this.failedSockets.delete(failedSocket);
      this.failedDropScheduled = false;
      if (this.failedSockets.size) this.scheduleFailedSocketDrops();
    });
  }

  send(ws, payload) {
    if (this.failedSockets.has(ws)) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      this.queueFailedSocket(ws);
    }
  }

  broadcast(payload, exceptUserId) {
    const line = JSON.stringify(payload);
    for (const [ws, connection] of this.peers) {
      if (
        connection.user.id === exceptUserId ||
        this.failedSockets.has(ws)
      ) {
        continue;
      }
      try {
        ws.send(line);
      } catch {
        this.queueFailedSocket(ws);
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
    this.pendingAttachmentWrites.delete(ws);
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
      this.pendingChats.delete(userId);
      const detachedChat = restoredChat(attachment?.connection?.chat);
      if (detachedChat) {
        const rev = Math.max(this.activitySequence + 1, detachedChat.rev + 1);
        this.activitySequence = rev;
        this.broadcast(
          {
            t: 'chat',
            id: userId,
            rev,
            text: '',
            a: detachedChat.a,
            fx: detachedChat.fx,
            fy: detachedChat.fy,
            color: colorForPublicId(userId),
            ttlMs: 0,
          },
          userId
        );
      }
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
    this.clearOwnedChat(user, connection);
    try {
      ws.close();
    } catch {
      /* already closed */
    }

    if (user.connections.size > 0) {
      user.stateSeq = ++this.activitySequence;
      this.syncUserState(user);
      this.persistUser(user, true);
      return;
    }

    // A refresh overlap or sibling tab keeps the stable user alive. The
    // identity guard means a delayed close from an older generation can never
    // delete a newly-created user record with the same private client id.
    if (this.users.get(user.clientId) !== user) return;
    this.users.delete(user.clientId);
    this.pendingCursors.delete(user.id);
    this.pendingChats.delete(user.id);
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
      this.pendingChats.clear();
      this.pendingLikeCounts.clear();
      this.pendingAttachmentWrites.clear();
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
    if (this.pendingChats.size) {
      const now = Date.now();
      const list = [];
      for (const [id, chat] of this.pendingChats) {
        this.pendingChats.delete(id);
        const ttlMs = Math.min(CHAT_TTL_MS, Math.ceil(chat.expiresAt - now));
        if (ttlMs > 0) {
          const { expiresAt: _expiresAt, ...entry } = chat;
          list.push({ ...entry, ttlMs });
        }
        if (list.length >= TICK_CHAT_CAP) break;
      }
      if (list.length) this.broadcast({ t: 'chats', list });
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
    if (this.pendingAttachmentWrites.size) {
      this.flushPendingConnectionPersists();
    }
    this.ensureTick();
  }

  ensureTick() {
    if (this.peers.size === 0) {
      if (this.tickTimer !== null) clearTimeout(this.tickTimer);
      this.tickTimer = null;
      this.countDirty = false;
      this.pendingCursors.clear();
      this.pendingChats.clear();
      this.pendingLikeCounts.clear();
      this.pendingAttachmentWrites.clear();
      return;
    }
    if (this.tickTimer !== null) return;
    if (
      !this.countDirty &&
      !this.pendingLikeCounts.size &&
      !this.pendingCursors.size &&
      !this.pendingChats.size &&
      !this.pendingAttachmentWrites.size
    ) {
      return;
    }
    this.tickTimer = setTimeout(() => this.tick(), TICK_MS);
  }

  cancelTickIfIdle() {
    if (
      this.tickTimer !== null &&
      !this.countDirty &&
      !this.pendingLikeCounts.size &&
      !this.pendingCursors.size &&
      !this.pendingChats.size &&
      !this.pendingAttachmentWrites.size
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
    const now = Date.now();

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
        chat: this.chatRosterEntry(other, now),
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
      chat: null,
      chatSeqs: new Map(),
      supersededChatSessions: new Set(),
      chatTokens: CHAT_RATE_BURST,
      chatTokenAt: 0,
      attachmentDirty: false,
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
    // JSON primitives (notably `null`) are valid JSON but not protocol
    // messages. Reading `msg.t` from null used to throw from the Durable
    // Object and was counted as an uncaught Worker exception.
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    const now = Date.now();
    const user = connection.user;
    const id = user.id;

    switch (msg.t) {
      case 'cursor': {
        if (now - connection.cursorAt < CURSOR_MIN_MS) break;
        connection.cursorAt = now;
        const entry = { a: msg.a, fx: msg.fx, fy: msg.fy };
        const event = { id, t: 'cursor', ...entry };
        connection.idle = false;
        connection.lastEvent = event;
        connection.cursorSeq = ++this.activitySequence;
        user.stateSeq = connection.cursorSeq;
        user.idle = false;
        user.lastEvent = event;
        this.pendingCursors.set(id, { ...entry, color: user.color });
        this.queueConnectionPersist(ws, connection);
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
      case 'chat': {
        const parsed = parseChatMessage(msg);
        if (!parsed || !this.applyChat(user, connection, parsed, now)) break;
        // Clear is a control message: broadcast and persist it immediately.
        // Ordinary typing state can share the 33 ms cursor/chat tick.
        this.persistChatChanges(user, ws, !parsed.text);
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
        this.persistConnection(ws, connection);
        break;
      }
      case 'spray': {
        if (now - connection.sprayAt < 250) break;
        connection.sprayAt = now;
        connection.spray = !!msg.on;
        user.stateSeq = ++this.activitySequence;
        this.syncUserState(user);
        this.persistConnection(ws, connection);
        break;
      }
      case 'idle': {
        const clearedChat = this.clearOwnedChat(user, connection);
        if (!connection.idle) {
          connection.idle = true;
          user.stateSeq = ++this.activitySequence;
          this.syncUserState(user);
          const persisted = this.persistConnection(ws, connection);
          if (clearedChat && !persisted) this.queueFailedSocket(ws);
        } else if (clearedChat) {
          if (!this.persistConnection(ws, connection)) {
            this.queueFailedSocket(ws);
          }
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
