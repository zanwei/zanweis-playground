/**
 * Cursor presence — the multiplayer layer.
 *
 * How recent.design does it (via visitors.now), replicated here:
 *   - every element that matters carries a `data-anchor` attribute
 *   - a cursor position is reported as (anchor, fx, fy) — fractions of that
 *     anchor's box — so cursors land on the *same card* for every viewer,
 *     even when the masonry reflows to a different column count
 *   - remote cursors are SVG arrows drawn into a fixed, pointer-events-none
 *     overlay and eased toward their target each frame
 *
 * Transport: SSE + POST against server.js. Without the server (static
 * hosting), BroadcastChannel gives real presence across the visitor's own
 * tabs — no fabricated ghosts.
 */
'use strict';

const Presence = (() => {
  const SEND_INTERVAL = 1000 / 30; // cursor reports top out at display-friendly ~30Hz
  const MAX_RENDERED = 30; // cursors drawn at once; beyond this they're noise
  const HEARTBEAT = 2000; // BroadcastChannel liveness ping
  const PEER_TIMEOUT = 5500;
  const IDLE_HIDE = 30000; // hide a cursor that hasn't moved in 30s
  const CHAT_TTL = 5000;
  const CHAT_MOVE_INTERVAL = 100;
  const CHAT_TEXT_MAX = 120;
  // .is-leaving runs at --duration-quick; +30ms of slack before removal.
  const LEAVE_MS =
    (parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--duration-quick')
    ) || 150) + 30;
  const CHAT_FADE_MS =
    (parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--duration-cursor-chat'
      )
    ) || 2000) + 30;
  const COLORS = ['orange', 'violet', 'green', 'pink', 'blue', 'amber'];
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
  // Private anonymous browser identity shared by presence and likes. Keeping
  // the original storage key preserves existing visitors across the protocol
  // upgrade. The server uses it to merge refreshes/tabs but never fans it out;
  // peers see only a temporary server-generated public id.
  const CLIENT_KEY = 'zw-like-client-v1';
  const LIKE_MINE_KEY = 'zw-like-mine-v1';
  const CLIENT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
  const CHAT_SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
  const CHAT_CONTROL_RE = /[\u0000-\u001f\u007f]/;

  // Peers announce a color NAME; the stylesheet owns the actual values.
  const cssColor = (c) => (c && c.startsWith('#') ? c : `var(--presence-${c || 'blue'})`);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function normalizeChatText(value) {
    if (typeof value !== 'string') return '';
    const clean = CHAT_CONTROL_RE.test(value)
      ? value.replace(/[\u0000-\u001f\u007f]/g, '')
      : value;
    // The common typing path is already clean and comfortably below the
    // protocol limit. Preserve the original string instead of allocating an
    // Array plus a second string for every keypress.
    if (clean.length <= CHAT_TEXT_MAX) return clean;
    return Array.from(clean).slice(0, CHAT_TEXT_MAX).join('');
  }

  function validChatPosition(anchor, fx, fy) {
    if (
      typeof anchor !== 'string' ||
      !/^(?:page|card:[a-z0-9-]+|shell:[a-z0-9-]+)$/.test(anchor) ||
      !Number.isFinite(fx) ||
      !Number.isFinite(fy) ||
      fx < 0 ||
      fx > 1
    ) {
      return false;
    }
    return anchor === 'page' ? fy >= 0 && fy <= 10_000_000 : fy >= 0 && fy <= 1;
  }

  function stableClientId() {
    try {
      const stored = localStorage.getItem(CLIENT_KEY);
      if (stored && CLIENT_ID_RE.test(stored)) return stored;
      const created =
        crypto.randomUUID?.() ||
        `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random()
          .toString(36)
          .slice(2)}`;
      localStorage.setItem(CLIENT_KEY, created);
      return created;
    } catch {
      return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random()
        .toString(36)
        .slice(2)}`;
    }
  }

  function colorForId(id) {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return COLORS[(hash >>> 0) % COLORS.length];
  }

  function storedLikes() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LIKE_MINE_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter((card) => LIKE_CARDS.has(card)) : []);
    } catch {
      return new Set();
    }
  }

  // --- cursor rendering ----------------------------------------------------

  const CURSOR_SVG = `
    <svg width="24" height="24" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5.09 5.36 10.48 20.73c.3.86 1.5.9 1.86.06l2.68-6.24a1 1 0 0 1 .52-.53l6.25-2.67c.83-.36.79-1.56-.07-1.87L6.36 4.09a1 1 0 0 0-1.27 1.27Z"
        fill="currentColor" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;

  const chatCursorByElement = new WeakMap();
  const chatResizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const cursor = chatCursorByElement.get(entry.target);
            if (!cursor) continue;
            const borderBox = Array.isArray(entry.borderBoxSize)
              ? entry.borderBoxSize[0]
              : entry.borderBoxSize;
            const borderWidth = Number(borderBox?.inlineSize);
            const borderHeight = Number(borderBox?.blockSize);
            const contentWidth = Number(entry.contentRect?.width);
            const contentHeight = Number(entry.contentRect?.height);
            const hasBorderSize = borderWidth > 0 && borderHeight > 0;
            const hasContentSize = contentWidth > 0 && contentHeight > 0;
            if (entry.target.hidden || (!hasBorderSize && !hasContentSize)) continue;
            const width = hasBorderSize ? borderWidth : contentWidth + 28;
            const height = hasBorderSize ? borderHeight : contentHeight + 16;
            if (width <= 0 || height <= 0) continue;
            cursor.chatSize = { width, height };
            cursor.placeChat(true);
          }
        })
      : null;

  class RemoteCursor {
    constructor(overlay, color) {
      this.el = document.createElement('div');
      this.el.className = 'presence-cursor';
      this.el.style.color = cssColor(color);
      this.el.innerHTML = `<div class="presence-cursor-inner">${CURSOR_SVG}</div>`;
      this.chatEl = document.createElement('div');
      this.chatEl.className = 'cursor-chat-bubble';
      this.chatEl.dataset.chatColor = COLORS.includes(color)
        ? color
        : colorForId(String(color || 'blue'));
      this.chatEl.setAttribute('aria-hidden', 'true');
      this.chatEl.hidden = true;
      this.chatText = document.createElement('span');
      this.chatText.className = 'cursor-chat-text';
      this.chatEl.appendChild(this.chatText);
      this.el.appendChild(this.chatEl);
      this.el.style.visibility = 'hidden';
      overlay.appendChild(this.el);
      this.x = 0;
      this.y = 0;
      this.target = null; // { anchor, fx, fy }
      this.anchorEl = null;
      this.seenAt = 0;
      this.placed = false;
      this.leaving = false;
      this.leaveTimer = null;
      this.chatTimer = null;
      this.chatRemovalTimer = null;
      this.chatExpiresAt = 0;
      this.chatTimerDue = 0;
      this.chatRev = -1;
      this.chatUpdatedAt = 0;
      this.chatSize = { width: 190, height: 35 };
      this.chatOffset = { x: Number.NaN, y: Number.NaN };
      this.renderedPosition = { x: Number.NaN, y: Number.NaN };
      this.visible = false;
      this.frameVisible = false;
      this.framePositionChanged = false;
      this.frameReset = false;
      this.framePopIn = false;
      this.viewportRevision = -1;
      chatCursorByElement.set(this.chatEl, this);
      chatResizeObserver?.observe(this.chatEl);
    }

    setTarget(anchor, fx, fy) {
      if (!validChatPosition(anchor, fx, fy)) return;
      const wasDormant = !this.placed || performance.now() - this.seenAt > IDLE_HIDE;
      const changed =
        !this.target ||
        this.target.anchor !== anchor ||
        Math.abs(this.target.fx - fx) > 0.00001 ||
        Math.abs(this.target.fy - fy) > 0.00001;
      // The anchor element only changes when the anchor string does — cache
      // it so resolve() doesn't run a document-wide query every frame.
      if (!this.target || this.target.anchor !== anchor) {
        this.anchorEl =
          anchor === 'page'
            ? null
            : document.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
      }
      this.target = { anchor, fx, fy };
      this.seenAt = performance.now();
      return changed || wasDormant;
    }

    get hasChat() {
      return !this.chatEl.hidden;
    }

    setChat({ text, rev, ttlMs, a, fx, fy }) {
      const nextRev = Number.isSafeInteger(rev) ? rev : this.chatRev + 1;
      if (nextRev <= this.chatRev) return false;
      this.chatRev = nextRev;
      const targetChanged = validChatPosition(a, fx, fy)
        ? this.setTarget(a, fx, fy)
        : false;

      // Incoming chat is normalized once by applyRemoteChat before a cursor
      // slot is allocated. Do not repeat the Unicode scan in the render path.
      const safeText = text;
      if (!safeText || safeText.trim() === '') {
        this.clearChat(true);
        return targetChanged;
      }

      clearTimeout(this.chatRemovalTimer);
      this.chatRemovalTimer = null;
      if (this.chatText.textContent !== safeText) this.chatText.textContent = safeText;
      if (this.chatEl.hidden) this.chatEl.hidden = false;
      this.chatEl.classList.remove('is-out');
      this.chatUpdatedAt = performance.now();
      const remaining = Math.max(0, Math.min(CHAT_TTL, Number(ttlMs) || CHAT_TTL));
      this.scheduleChatExpiry(remaining);
      this.placeChat();
      return targetChanged;
    }

    scheduleChatExpiry(remaining) {
      const deadline = performance.now() + remaining;
      this.chatExpiresAt = deadline;
      // Extending a live deadline does not churn the timer; its existing
      // callback will re-check once. A shorter roster/reconnect TTL must move
      // the callback earlier so stale text never lingers.
      if (this.chatTimer !== null && deadline >= this.chatTimerDue - 1) return;
      if (this.chatTimer !== null) clearTimeout(this.chatTimer);
      const expire = () => {
        this.chatTimer = null;
        this.chatTimerDue = 0;
        const delay = this.chatExpiresAt - performance.now();
        if (delay > 1) {
          this.chatTimerDue = this.chatExpiresAt;
          this.chatTimer = setTimeout(expire, delay);
          return;
        }
        this.clearChat();
      };
      this.chatTimerDue = deadline;
      this.chatTimer = setTimeout(expire, remaining);
    }

    clearChat(immediate = false) {
      clearTimeout(this.chatTimer);
      clearTimeout(this.chatRemovalTimer);
      this.chatTimer = null;
      this.chatRemovalTimer = null;
      this.chatExpiresAt = 0;
      this.chatTimerDue = 0;
      if (this.chatEl.hidden) return;
      if (immediate) {
        this.chatEl.hidden = true;
        this.chatEl.classList.remove('is-out');
        this.chatText.textContent = '';
        return;
      }
      this.chatEl.classList.add('is-out');
      this.chatRemovalTimer = setTimeout(() => {
        this.chatRemovalTimer = null;
        if (!this.chatEl.classList.contains('is-out')) return;
        this.chatEl.hidden = true;
        this.chatEl.classList.remove('is-out');
        this.chatText.textContent = '';
      }, CHAT_FADE_MS);
    }

    placeChat(
      force = false,
      viewport = { width: innerWidth, height: innerHeight }
    ) {
      if (this.chatEl.hidden) return;
      const { width, height } = this.chatSize;
      const gutter = 8;
      let dx = this.x + 26 + width <= viewport.width - gutter ? 26 : -width - 14;
      let dy = this.y + 22 + height <= viewport.height - gutter ? 22 : -height - 14;
      dx = Math.max(
        gutter - this.x,
        Math.min(dx, viewport.width - gutter - width - this.x)
      );
      dy = Math.max(
        gutter - this.y,
        Math.min(dy, viewport.height - gutter - height - this.y)
      );
      const x = Math.round(dx);
      const y = Math.round(dy);
      if (!force && x === this.chatOffset.x && y === this.chatOffset.y) return;
      this.chatOffset = { x, y };
      this.chatEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    resolveAnchorElement() {
      if (!this.target || this.target.anchor === 'page') return null;
      if (!this.anchorEl || !this.anchorEl.isConnected) {
        this.anchorEl = document.querySelector(
          `[data-anchor="${CSS.escape(this.target.anchor)}"]`
        );
      }
      return this.anchorEl;
    }

    resolve(frameGeometry) {
      if (!this.target) return null;
      const { anchor, fx, fy } = this.target;
      if (anchor === 'page') {
        // fx is a fraction of document width, fy an absolute document offset
        return {
          x: fx * frameGeometry.pageWidth - frameGeometry.scrollX,
          y: fy - frameGeometry.scrollY,
        };
      }
      const rect =
        this.anchorEl && frameGeometry.anchorRects.get(this.anchorEl);
      // A hidden or zero-area anchor means "this card isn't on screen here" —
      // hide the cursor rather than resolving it to the viewport corner.
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      return { x: rect.left + fx * rect.width, y: rect.top + fy * rect.height };
    }

    setVisible(visible) {
      if (visible === this.visible) return;
      this.visible = visible;
      this.el.style.visibility = visible ? 'visible' : 'hidden';
    }

    update(now, dt, tau, frameGeometry) {
      this.framePositionChanged = false;
      this.frameReset = false;
      this.framePopIn = false;
      const p = this.resolve(frameGeometry);
      if (!p || now - this.seenAt > IDLE_HIDE) {
        this.frameVisible = false;
        this.placed = false; // reappear with the pop-in, not a flight across
        this.frameReset = true;
        return false;
      }
      if (!this.placed) {
        // First (re)appearance: start at the target and pop in from the tip.
        this.x = p.x;
        this.y = p.y;
        this.placed = true;
        this.framePopIn = true;
      } else {
        // Exponential time-based damping: identical feel at 60/120/144Hz.
        // Snap the sub-pixel tail so a settled room can park its RAF loop.
        const k = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / (tau || 51));
        this.x += (p.x - this.x) * k;
        this.y += (p.y - this.y) * k;
        if (Math.abs(p.x - this.x) <= 0.25) this.x = p.x;
        if (Math.abs(p.y - this.y) <= 0.25) this.y = p.y;
      }
      const onScreen =
        this.x > -40 &&
        this.y > -40 &&
        this.x < frameGeometry.width + 40 &&
        this.y < frameGeometry.height + 40;
      this.frameVisible = onScreen;
      const renderedX = Math.round(this.x * 10) / 10;
      const renderedY = Math.round(this.y * 10) / 10;
      if (
        renderedX !== this.renderedPosition.x ||
        renderedY !== this.renderedPosition.y
      ) {
        this.renderedPosition = { x: renderedX, y: renderedY };
        this.framePositionChanged = true;
      }
      return Math.abs(p.x - this.x) > 0.25 || Math.abs(p.y - this.y) > 0.25;
    }

    render(frameGeometry) {
      // frame() resolves every unique anchor before entering this write-only
      // phase, so one cursor's transform cannot invalidate the next cursor's
      // getBoundingClientRect().
      this.setVisible(this.frameVisible);
      if (this.frameReset) this.el.classList.remove('is-in');
      if (this.framePositionChanged) {
        const { x, y } = this.renderedPosition;
        this.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      if (
        this.framePositionChanged ||
        this.viewportRevision !== frameGeometry.revision
      ) {
        this.viewportRevision = frameGeometry.revision;
        this.placeChat(false, frameGeometry);
      }
      if (this.framePopIn) {
        requestAnimationFrame(() => {
          if (this.placed) this.el.classList.add('is-in');
        });
      }
    }

    leave(onDone) {
      if (this.leaving) return;
      // Scale back into the tip, then drop the node — revivable mid-fade.
      this.clearChat(true);
      this.leaving = true;
      this.el.classList.remove('is-in');
      this.el.classList.add('is-leaving');
      this.leaveTimer = setTimeout(() => {
        this.destroy();
        onDone();
      }, LEAVE_MS);
    }

    revive() {
      clearTimeout(this.leaveTimer);
      this.leaving = false;
      this.el.classList.remove('is-leaving');
      this.placed = false; // pops back in from the tip
    }

    destroy() {
      clearTimeout(this.leaveTimer);
      clearTimeout(this.chatTimer);
      clearTimeout(this.chatRemovalTimer);
      chatResizeObserver?.unobserve(this.chatEl);
      chatCursorByElement.delete(this.chatEl);
      this.el.remove();
    }
  }

  // --- anchor helpers ------------------------------------------------------

  function anchorFor(x, y, viewport) {
    const el = document.elementFromPoint(x, y);
    const host = el && el.closest('[data-anchor]');
    if (host) {
      const rect = host.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          anchor: host.dataset.anchor,
          fx: (x - rect.left) / rect.width,
          fy: (y - rect.top) / rect.height,
        };
      }
    }
    const pageWidth = Math.max(
      1,
      viewport?.pageWidth || document.documentElement.clientWidth
    );
    const pageScrollX = viewport?.scrollX ?? scrollX;
    const pageScrollY = viewport?.scrollY ?? scrollY;
    return {
      anchor: 'page',
      fx: (x + pageScrollX) / pageWidth,
      fy: y + pageScrollY,
    };
  }

  // --- main ----------------------------------------------------------------

  function start({
    onCount,
    onFocus,
    onSelf,
    onLocations,
    onBullet,
    onSpray,
    onLikes,
    onLike,
    loc,
  } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'presence-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    // The crowd sets the pace: a small room runs a realtime tier (30Hz
    // reports, tight damping), bigger rooms lower their voice step by step.
    // Past 400 the cursor layer goes quiet — the count carries the story.
    let sendEvery = SEND_INTERVAL;
    let dampTau = 51; // ms; smaller = remote cursors track tighter
    function paceForCount(n) {
      if (n <= 12) {
        sendEvery = SEND_INTERVAL;
        dampTau = 30;
      } else {
        sendEvery = n <= 30 ? SEND_INTERVAL : n <= 150 ? 100 : n <= 400 ? 250 : Infinity;
        dampTau = 51;
      }
    }
    paceForCount(1);

    const cursors = new Map(); // peerId -> RemoteCursor
    const focuses = new Map(); // peerId -> { card, color }
    const locations = new Map(); // peerId -> { color, loc }
    const clientId = stableClientId();
    const likeCounts = new Map();
    const myLikes = storedLikes();
    const pendingLikes = new Map(); // card -> desired boolean, until server ack
    const likeRetryTimers = new Map();
    let send = () => {};
    let sendCursor = () => {};
    let transport = 'pending';
    let myId = null;
    let myFocus = null; // replayed once the transport comes up (deep links)
    let chatReplay = null;
    let chatTrackingUntil = 0;
    let pendingLocalChat = null;
    let latestPointerAnchor = null;
    const viewportMetrics = {
      width: innerWidth,
      height: innerHeight,
      pageWidth: Math.max(1, document.documentElement.clientWidth),
      scrollX,
      scrollY,
      revision: 0,
    };

    function pageAnchorFor(x, y) {
      return {
        anchor: 'page',
        fx: (x + viewportMetrics.scrollX) / viewportMetrics.pageWidth,
        fy: y + viewportMetrics.scrollY,
      };
    }

    function cachedAnchorFor(snapshot) {
      if (
        latestPointerAnchor &&
        latestPointerAnchor.revision === viewportMetrics.revision &&
        Math.abs(latestPointerAnchor.x - snapshot.x) <= 0.5 &&
        Math.abs(latestPointerAnchor.y - snapshot.y) <= 0.5
      ) {
        return latestPointerAnchor.position;
      }
      // Clear/replay must never force a hit-test in an input or WebSocket
      // callback. A following cursor sample will refine a page fallback.
      return pageAnchorFor(snapshot.x, snapshot.y);
    }

    function notifyLocations() {
      if (onLocations) onLocations([...locations.values()]);
    }

    function persistMyLikes() {
      try {
        localStorage.setItem(LIKE_MINE_KEY, JSON.stringify([...myLikes]));
      } catch {
        /* storage is best-effort; the server remains authoritative */
      }
    }

    function likeSnapshot() {
      return {
        counts: Object.fromEntries(likeCounts),
        mine: [...myLikes],
      };
    }

    function notifyLike(card) {
      if (!onLike) return;
      onLike({
        card,
        count: likeCounts.get(card) || 0,
        on: myLikes.has(card),
      });
    }

    function applyLikeSnapshot(snapshot) {
      const nextCounts = new Map();
      for (const [card, count] of Object.entries(snapshot?.counts || {})) {
        if (!LIKE_CARDS.has(card)) continue;
        nextCounts.set(card, Math.max(0, Math.floor(Number(count) || 0)));
      }

      const nextMine = new Set(
        Array.isArray(snapshot?.mine)
          ? snapshot.mine.filter((card) => LIKE_CARDS.has(card))
          : []
      );

      // A click made while the connection was coming up stays optimistic.
      // Overlay that desired SET on the authoritative snapshot, then send it.
      for (const [card, desired] of pendingLikes) {
        const serverOn = nextMine.has(card);
        if (desired !== serverOn) {
          nextCounts.set(
            card,
            Math.max(0, (nextCounts.get(card) || 0) + (desired ? 1 : -1))
          );
        }
        if (desired) nextMine.add(card);
        else nextMine.delete(card);
      }

      likeCounts.clear();
      for (const [card, count] of nextCounts) likeCounts.set(card, count);
      myLikes.clear();
      for (const card of nextMine) myLikes.add(card);
      persistMyLikes();
      if (onLikes) onLikes(likeSnapshot());
    }

    function applyLikeMessage(msg) {
      if (!LIKE_CARDS.has(msg.card)) return;
      let count = Math.max(0, Math.floor(Number(msg.count) || 0));

      if (typeof msg.on === 'boolean') {
        const desired = pendingLikes.get(msg.card);
        if (desired === msg.on) {
          pendingLikes.delete(msg.card);
          clearTimeout(likeRetryTimers.get(msg.card));
          likeRetryTimers.delete(msg.card);
        } else if (typeof desired === 'boolean') {
          // This is an ack for an older SET. Preserve the latest click while
          // adjusting the server count to the state currently shown locally.
          count = Math.max(0, count + (desired ? 1 : -1));
          transmitLike(msg.card, desired);
        }

        const effective = pendingLikes.has(msg.card) ? pendingLikes.get(msg.card) : msg.on;
        if (effective) myLikes.add(msg.card);
        else myLikes.delete(msg.card);
      }

      likeCounts.set(msg.card, count);
      persistMyLikes();
      notifyLike(msg.card);
    }

    function transmitLike(card, on) {
      if (transport === 'pending') return;
      send({ t: 'like', card, on, count: likeCounts.get(card) || 0 });

      if (transport === 'tabs' || transport === 'solo') {
        pendingLikes.delete(card);
        return;
      }

      // The transport enforces a small per-peer ingest floor. If a user
      // reverses a like faster than that floor, retry the latest idempotent
      // SET until its authoritative acknowledgement arrives.
      clearTimeout(likeRetryTimers.get(card));
      likeRetryTimers.set(
        card,
        setTimeout(() => {
          if (pendingLikes.get(card) === on) transmitLike(card, on);
        }, 160)
      );
    }

    function flushPendingLikes() {
      for (const [card, on] of pendingLikes) transmitLike(card, on);
    }

    function chatWirePayload(snapshot, ttlMs, position) {
      return {
        t: 'chat',
        session: snapshot.session,
        seq: snapshot.seq,
        rev: snapshot.seq, // BroadcastChannel has no server revision.
        text: snapshot.text,
        a: position.anchor,
        fx: position.fx,
        fy: position.fy,
        ttlMs,
      };
    }

    function replayCursorChat() {
      if (!chatReplay) return;
      const remaining = chatReplay.expiresAt - Date.now();
      if (remaining <= 0) {
        chatReplay = null;
        chatTrackingUntil = 0;
        return;
      }
      send(
        chatWirePayload(
          chatReplay,
          Math.min(CHAT_TTL, remaining),
          cachedAnchorFor(chatReplay)
        )
      );
    }

    const pendingRemoteChats = new Map();
    let remoteChatFrame = null;

    function applyRemoteChat(msg) {
      const peerId = String(msg.id);
      const safeText = normalizeChatText(msg.text);
      if (!safeText || safeText.trim() === '') {
        const cursor = cursors.get(peerId);
        if (
          cursor?.setChat({
            text: '',
            rev: msg.rev,
            ttlMs: msg.ttlMs,
            a: msg.a,
            fx: msg.fx,
            fy: msg.fy,
          })
        ) {
          ensureLoop();
        }
        return;
      }
      if (!validChatPosition(msg.a, msg.fx, msg.fy)) return;
      const cursor = peerCursor(peerId, msg.color, true);
      if (
        cursor?.setChat({
          text: safeText,
          rev: msg.rev,
          ttlMs: msg.ttlMs,
          a: msg.a,
          fx: msg.fx,
          fy: msg.fy,
        })
      ) {
        ensureLoop();
      }
    }

    function flushRemoteChats() {
      remoteChatFrame = null;
      const updates = [...pendingRemoteChats.values()];
      pendingRemoteChats.clear();
      for (const update of updates) applyRemoteChat(update);
    }

    function queueRemoteChat(msg) {
      const peerId = String(msg.id);
      if (peerId === String(myId)) return;
      const previous = pendingRemoteChats.get(peerId);
      if (
        previous &&
        Number.isSafeInteger(previous.rev) &&
        Number.isSafeInteger(msg.rev) &&
        msg.rev <= previous.rev
      ) {
        return;
      }
      pendingRemoteChats.set(peerId, msg);
      if (remoteChatFrame === null) {
        remoteChatFrame = requestAnimationFrame(flushRemoteChats);
      }
    }

    function evictCursorForChat() {
      let candidate = null;
      for (const entry of cursors) {
        const [, cursor] = entry;
        // Keep active and fading chats in stable DOM slots. Rotating 31+
        // active peers through a 30-cursor cap causes continuous SVG parsing,
        // layer promotion, and timer churn under load.
        if (!cursor.chatEl.hidden || cursor.leaving) continue;
        if (!candidate || cursor.seenAt < candidate[1].seenAt) {
          candidate = entry;
        }
      }
      if (!candidate) return false;
      const [id, cursor] = candidate;
      cursor.destroy();
      cursors.delete(id);
      return true;
    }

    function peerCursor(id, color, prioritizeChat = false) {
      const peerId = String(id);
      let c = cursors.get(peerId);
      if (!c) {
        // In a real crowd, arrows past the first few dozen are pure noise —
        // chat takes the scarce slots from the stalest quiet cursor first.
        if (cursors.size >= MAX_RENDERED && (!prioritizeChat || !evictCursorForChat())) {
          return null;
        }
        c = new RemoteCursor(overlay, color);
        cursors.set(peerId, c);
        ensureLoop();
      } else if (c.leaving) {
        c.revive(); // returning peer reuses the fading cursor, no duplicate
      }
      return c;
    }

    function dropPeer(id) {
      const peerId = String(id);
      pendingRemoteChats.delete(peerId);
      const c = cursors.get(peerId);
      if (c) c.leave(() => cursors.delete(peerId));
      if (focuses.delete(id) && onFocus) onFocus([...focuses.values()]);
      if (locations.delete(id)) notifyLocations();
    }

    function dropAllPeers() {
      pendingRemoteChats.clear();
      if (remoteChatFrame !== null) cancelAnimationFrame(remoteChatFrame);
      remoteChatFrame = null;
      const ids = new Set([
        ...cursors.keys(),
        ...focuses.keys(),
        ...locations.keys(),
      ]);
      for (const id of ids) dropPeer(id);
    }

    function handle(msg) {
      // A stable user can have more than one live transport (overlapping
      // refreshes and multiple tabs). The server fans room frames to every
      // connection, so defensively ignore our own public presence id here.
      // Like messages are intentionally delivered to all of a user's tabs.
      const ownPresence =
        msg.id != null && myId != null && String(msg.id) === String(myId);
      if (
        ownPresence &&
        (msg.t === 'cursor' ||
          msg.t === 'focus' ||
          msg.t === 'loc' ||
          msg.t === 'bullet' ||
          msg.t === 'chat' ||
          msg.t === 'spray' ||
          msg.t === 'idle' ||
          msg.t === 'leave')
      ) {
        return;
      }

      switch (msg.t) {
        case 'cursor': {
          const cursor = peerCursor(msg.id, msg.color);
          if (cursor?.setTarget(msg.a, msg.fx, msg.fy)) ensureLoop();
          break;
        }
        case 'cursors':
          // Server tick frame: the latest position for every peer that moved.
          for (const e of msg.list || []) {
            if (String(e.id) === String(myId)) continue;
            const cursor = peerCursor(e.id, e.color);
            if (cursor?.setTarget(e.a, e.fx, e.fy)) ensureLoop();
          }
          break;
        case 'chat':
          queueRemoteChat(msg);
          break;
        case 'chats':
          for (const entry of msg.list || []) {
            if (String(entry.id) === String(myId)) continue;
            queueRemoteChat(entry);
          }
          break;
        case 'focus':
          if (msg.card) focuses.set(msg.id, { card: msg.card, color: cssColor(msg.color) });
          else focuses.delete(msg.id);
          if (onFocus) onFocus([...focuses.values()]);
          break;
        case 'loc':
          if (msg.loc) {
            locations.set(msg.id, { color: cssColor(msg.color), loc: msg.loc });
            notifyLocations();
          }
          break;
        case 'bullet':
          if (onBullet && typeof msg.text === 'string' && msg.text) {
            onBullet({ text: msg.text.slice(0, 120), color: cssColor(msg.color) });
          }
          break;
        case 'spray':
          if (onSpray) onSpray({ id: String(msg.id), on: !!msg.on });
          break;
        case 'like':
          applyLikeMessage(msg);
          break;
        case 'likes':
          for (const [card, count] of Object.entries(msg.counts || {})) {
            applyLikeMessage({ t: 'like', card, count });
          }
          break;
        case 'idle': {
          // Backgrounded, not gone: retract the cursor, keep the location.
          const peerId = String(msg.id);
          pendingRemoteChats.delete(peerId);
          const c = cursors.get(peerId);
          if (c) c.leave(() => cursors.delete(peerId));
          break;
        }
        case 'leave':
          dropPeer(msg.id);
          break;
      }
    }

    // One shared RAF, like recent.design's scheduler: run at display cadence
    // only while cursors are moving, then park until state or layout changes.
    let rafId = null;
    let parkedTimer = null;
    let lastFrame = 0;
    const frameGeometry = { ...viewportMetrics, anchorRects: new Map() };
    function frame(now) {
      rafId = null;
      const dt = lastFrame ? Math.min(250, now - lastFrame) : 1000 / 60;
      lastFrame = now;
      Object.assign(frameGeometry, viewportMetrics);
      const { anchorRects } = frameGeometry;
      anchorRects.clear();
      // Read each unique card geometry once. No cursor style is mutated until
      // the second render loop below, which prevents read/write/read layout
      // thrashing when several peers share an anchor.
      for (const c of cursors.values()) {
        const anchorEl = c.resolveAnchorElement();
        if (anchorEl && !anchorRects.has(anchorEl)) {
          anchorRects.set(anchorEl, anchorEl.getBoundingClientRect());
        }
      }
      let stale = null;
      let moving = false;
      for (const [id, c] of cursors) {
        if (c.update(now, dt, dampTau, frameGeometry)) moving = true;
        // Long-hidden cursors leave the map entirely, so an idle room's
        // loop can park instead of ticking ghosts forever.
        if (!c.leaving && now - c.seenAt > IDLE_HIDE * 2) (stale ||= []).push(id);
      }
      for (const c of cursors.values()) c.render(frameGeometry);
      if (stale) {
        for (const id of stale) {
          const c = cursors.get(id);
          if (c) c.leave(() => cursors.delete(id));
        }
      }
      if (cursors.size === 0) {
        lastFrame = 0;
      } else if (moving) {
        rafId = requestAnimationFrame(frame);
      } else {
        lastFrame = 0;
        parkedTimer = setTimeout(() => {
          parkedTimer = null;
          ensureLoop();
        }, 1000);
      }
    }
    function ensureLoop() {
      if (parkedTimer !== null) {
        clearTimeout(parkedTimer);
        parkedTimer = null;
      }
      if (rafId === null) rafId = requestAnimationFrame(frame);
    }
    function refreshViewportScroll() {
      const nextScrollX = scrollX;
      const nextScrollY = scrollY;
      if (
        nextScrollX !== viewportMetrics.scrollX ||
        nextScrollY !== viewportMetrics.scrollY
      ) {
        viewportMetrics.scrollX = nextScrollX;
        viewportMetrics.scrollY = nextScrollY;
        viewportMetrics.revision += 1;
      }
      ensureLoop();
    }
    function refreshViewportSize() {
      const nextWidth = innerWidth;
      const nextHeight = innerHeight;
      const nextPageWidth = Math.max(1, document.documentElement.clientWidth);
      if (
        nextWidth !== viewportMetrics.width ||
        nextHeight !== viewportMetrics.height ||
        nextPageWidth !== viewportMetrics.pageWidth
      ) {
        viewportMetrics.width = nextWidth;
        viewportMetrics.height = nextHeight;
        viewportMetrics.pageWidth = nextPageWidth;
        viewportMetrics.revision += 1;
      }
      refreshViewportScroll();
    }
    addEventListener('scroll', refreshViewportScroll, { passive: true });
    addEventListener('resize', refreshViewportSize, { passive: true });
    window.visualViewport?.addEventListener('resize', refreshViewportSize, {
      passive: true,
    });

    // --- transport: SSE first, BroadcastChannel fallback -------------------

    // Transport ladder: WebSocket (the deployed Worker) -> SSE (`node
    // server.js` locally) -> BroadcastChannel (static hosting, tab-local).
    function startWS() {
      let ws;
      try {
        const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(
          `${scheme}://${location.host}/presence/ws?client=${encodeURIComponent(clientId)}`
        );
      } catch {
        startSSE();
        return;
      }
      let opened = false;

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'hello') {
          opened = true;
          transport = 'ws';
          myId = msg.id;
          const colorName = COLORS.includes(msg.color)
            ? msg.color
            : colorForId(String(myId || clientId));
          if (onSelf) {
            onSelf({ color: cssColor(colorName), colorName, transport: 'ws' });
          }
          for (const peer of msg.peers || []) {
            if (String(peer.id) === String(myId)) continue;
            if (peer.last) handle({ ...peer.last, color: peer.color });
            if (peer.loc) handle({ t: 'loc', id: peer.id, color: peer.color, loc: peer.loc });
            if (peer.chat) handle({ t: 'chat', id: peer.id, color: peer.color, ...peer.chat });
          }
          // The socket authenticates this connection; hello's id is the
          // stable public user identity shared by reconnects and sibling tabs.
          const sendWS = (payload) => {
            if (ws.readyState === 1) ws.send(JSON.stringify(payload));
          };
          send = sendWS;
          sendCursor = sendWS;
          applyLikeSnapshot(msg.likes);
          flushPendingLikes();
          if (myFocus) send({ t: 'focus', card: myFocus });
          if (loc) send({ t: 'loc', loc });
          replayCursorChat();
        } else if (msg.t === 'count') {
          paceForCount(msg.n);
          if (onCount) onCount(msg.n);
        } else {
          handle(msg);
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      };
      ws.onclose = () => {
        if (!opened) {
          // No WS endpoint here (node server.js) — walk down the ladder.
          startSSE();
          return;
        }
        // Unlike EventSource, WS has no built-in retry: clear unreachable
        // peers and reconnect with a fresh socket.
        dropAllPeers();
        transport = 'pending';
        send = () => {};
        sendCursor = () => {};
        if (onCount) onCount(1);
        setTimeout(startWS, 1800);
      };
    }

    function startSSE() {
      const es = new EventSource(
        `/presence/stream?client=${encodeURIComponent(clientId)}`
      );
      let opened = false;
      let myToken = null;
      let cursorPostEpoch = 0;
      let cursorPostActive = false;
      let cursorPostInFlight = false;
      let cursorPostPending = null;
      let cursorPostController = null;
      let chatPostEpoch = 0;
      let chatPostActive = false;
      let chatPostInFlight = false;
      let chatPostPending = null;
      let chatPostController = null;

      function resetCursorPosts(active = false) {
        cursorPostEpoch += 1;
        cursorPostActive = active;
        cursorPostPending = null;
        cursorPostInFlight = false;
        cursorPostController?.abort();
        cursorPostController = null;
      }

      function resetChatPosts(active = false) {
        chatPostEpoch += 1;
        chatPostActive = active;
        chatPostPending = null;
        chatPostInFlight = false;
        chatPostController?.abort();
        chatPostController = null;
      }

      function authenticatedBody(payload) {
        return JSON.stringify({ id: myId, token: myToken, ...payload });
      }

      function sendSSEControl(payload) {
        if (payload?.t === 'chat' && payload.text) {
          sendSSEChat(payload);
          return;
        }
        if (payload?.t === 'idle') {
          // Do not let an older queued/in-flight cursor arrive after the
          // immediate retract and make a departed pointer reappear.
          resetCursorPosts(cursorPostActive);
        }
        if (payload?.t === 'idle' || payload?.t === 'chat') {
          // A clear must overtake every queued typing update. Session/seq
          // validation handles an already-accepted older request.
          resetChatPosts(chatPostActive);
        }
        const body = authenticatedBody(payload);
        let accepted = false;
        try {
          accepted =
            navigator.sendBeacon?.('/presence/event', body) === true;
        } catch {
          /* fetch below is the reliable fallback */
        }
        if (accepted) return;
        fetch('/presence/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }

      function flushSSEChat() {
        if (!chatPostActive || chatPostInFlight || chatPostPending === null) {
          return;
        }
        const body = chatPostPending;
        const epoch = chatPostEpoch;
        chatPostPending = null;
        chatPostInFlight = true;
        chatPostController =
          typeof AbortController === 'function' ? new AbortController() : null;

        fetch('/presence/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
          ...(chatPostController
            ? { signal: chatPostController.signal }
            : {}),
        })
          .catch(() => {})
          .finally(() => {
            if (epoch !== chatPostEpoch) return;
            chatPostInFlight = false;
            chatPostController = null;
            flushSSEChat();
          });
      }

      function sendSSEChat(payload) {
        if (!chatPostActive) return;
        // Typing is live state, not a queue: a slow request keeps only the
        // newest confirmed value. Clears still use the immediate control path.
        chatPostPending = authenticatedBody(payload);
        flushSSEChat();
      }

      function flushSSECursor() {
        if (
          !cursorPostActive ||
          cursorPostInFlight ||
          cursorPostPending === null
        ) {
          return;
        }
        const body = cursorPostPending;
        const epoch = cursorPostEpoch;
        cursorPostPending = null;
        cursorPostInFlight = true;
        cursorPostController =
          typeof AbortController === 'function' ? new AbortController() : null;

        fetch('/presence/event', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
          ...(cursorPostController
            ? { signal: cursorPostController.signal }
            : {}),
        })
          .catch(() => {})
          .finally(() => {
            if (epoch !== cursorPostEpoch) return;
            cursorPostInFlight = false;
            cursorPostController = null;
            flushSSECursor();
          });
      }

      function sendSSECursor(payload) {
        if (!cursorPostActive) return;
        // A slow POST never builds an unbounded queue: keep only the newest
        // serialized cursor while the current request is in flight.
        cursorPostPending = authenticatedBody(payload);
        flushSSECursor();
      }

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'hello') {
          opened = true;
          transport = 'sse';
          myId = msg.id;
          myToken = msg.token;
          const colorName = COLORS.includes(msg.color)
            ? msg.color
            : colorForId(String(myId || clientId));
          if (onSelf) {
            onSelf({ color: cssColor(colorName), colorName, transport: 'sse' });
          }
          for (const peer of msg.peers || []) {
            if (String(peer.id) === String(myId)) continue;
            if (peer.last) handle({ ...peer.last, color: peer.color });
            if (peer.loc) handle({ t: 'loc', id: peer.id, color: peer.color, loc: peer.loc });
            if (peer.chat) handle({ t: 'chat', id: peer.id, color: peer.color, ...peer.chat });
          }
          resetCursorPosts(true);
          resetChatPosts(true);
          send = sendSSEControl;
          sendCursor = sendSSECursor;
          applyLikeSnapshot(msg.likes);
          flushPendingLikes();
          if (myFocus) send({ t: 'focus', card: myFocus });
          if (loc) send({ t: 'loc', loc });
          replayCursorChat();
        } else if (msg.t === 'count') {
          paceForCount(msg.n);
          if (onCount) onCount(msg.n);
        } else {
          handle(msg);
        }
      };

      es.onerror = () => {
        if (!opened) {
          // Never connected — no server, so use the cross-tab channel.
          es.close();
          startBroadcast();
          return;
        }
        // A dropped stream is recoverable: leave EventSource alone so the
        // browser reconnects (it re-issues hello with a fresh id/token), and
        // just clear peers who are no longer reachable.
        dropAllPeers();
        transport = 'pending';
        resetCursorPosts();
        resetChatPosts();
        send = () => {};
        sendCursor = () => {};
        if (onCount) onCount(1);
      };
    }

    function startBroadcast() {
      let bc;
      try {
        bc = new BroadcastChannel('zw-playground-presence');
      } catch {
        transport = 'solo';
        send = () => {};
        sendCursor = () => {};
        if (onCount) onCount(1);
        const colorName = colorForId(clientId);
        if (onSelf) {
          onSelf({ color: cssColor(colorName), colorName, transport: 'solo' });
        }
        applyLikeSnapshot({
          counts: Object.fromEntries([...myLikes].map((card) => [card, 1])),
          mine: [...myLikes],
        });
        return;
      }
      transport = 'tabs';
      // BroadcastChannel is tab-local presence, not the server's user
      // aggregation boundary. Give each tab a fresh public id and never put
      // the private stable client id onto the channel.
      myId =
        crypto.randomUUID?.() ||
        `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      const myColor = colorForId(myId);
      if (onSelf) {
        onSelf({ color: cssColor(myColor), colorName: myColor, transport: 'tabs' });
      }
      const alive = new Map(); // id -> lastSeen

      function census() {
        const now = Date.now();
        for (const [id, t] of alive) {
          if (now - t > PEER_TIMEOUT) {
            alive.delete(id);
            dropPeer(id);
          }
        }
        if (onCount) onCount(alive.size + 1);
      }

      bc.onmessage = (e) => {
        const msg = e.data;
        if (msg.id === myId) return;
        alive.set(msg.id, Date.now());
        // Heartbeats carry the peer's coarse location so late joiners get it.
        if (msg.t === 'hb' && msg.loc && !locations.has(msg.id)) {
          locations.set(msg.id, { color: cssColor(msg.color), loc: msg.loc });
          notifyLocations();
        }
        if (msg.t !== 'hb') handle(msg);
        census();
      };

      const sendBroadcast = (payload) =>
        bc.postMessage({
          id: myId,
          color: myColor,
          loc: loc || null,
          ...payload,
        });
      send = sendBroadcast;
      sendCursor = sendBroadcast;
      applyLikeSnapshot({
        counts: Object.fromEntries([...myLikes].map((card) => [card, 1])),
        mine: [...myLikes],
      });
      flushPendingLikes();
      send({ t: 'hb' });
      if (myFocus) send({ t: 'focus', card: myFocus });
      replayCursorChat();
      setInterval(() => {
        send({ t: 'hb' });
        census();
      }, HEARTBEAT);
      census();
    }

    if (location.protocol === 'file:') startBroadcast();
    else startWS();

    // --- local input -> reports --------------------------------------------

    let lastSent = -Infinity;
    let pointerPending = false;
    let pointerTimer = null;
    let pointerTimerDue = 0;
    let latestPointer = { x: innerWidth / 2, y: innerHeight / 2 };

    function pointerReportInterval(now) {
      if (now < chatTrackingUntil) {
        return sendEvery === Infinity
          ? CHAT_MOVE_INTERVAL
          : Math.min(sendEvery, CHAT_MOVE_INTERVAL);
      }
      return sendEvery;
    }

    function cancelPendingPointer() {
      if (pointerTimer !== null) clearTimeout(pointerTimer);
      pointerTimer = null;
      pointerTimerDue = 0;
      pointerPending = false;
      pendingLocalChat = null;
    }

    function schedulePointer(now, allowEarlier = false) {
      if (!pointerPending && !pendingLocalChat) return;
      const interval = pointerReportInterval(now);
      if (interval === Infinity) {
        cancelPendingPointer();
        return;
      }
      const delay = Math.max(0, interval - (now - lastSent));
      const due = now + delay;
      if (pointerTimer !== null) {
        // Pointer events only overwrite latestPointer while a trailing edge is
        // armed. Cursor Chat may explicitly pull a slow crowd timer forward.
        if (!allowEarlier || pointerTimerDue <= due + 0.5) return;
        clearTimeout(pointerTimer);
      }
      pointerTimerDue = due;
      pointerTimer = setTimeout(() => {
        pointerTimer = null;
        pointerTimerDue = 0;
        flushPointer(performance.now());
      }, delay);
    }

    function flushPointer(now) {
      if (!pointerPending && !pendingLocalChat) return;
      const interval = pointerReportInterval(now);
      if (interval === Infinity) {
        cancelPendingPointer();
        return;
      }
      if (now - lastSent < interval) {
        schedulePointer(now);
        return;
      }

      const x = latestPointer.x;
      const y = latestPointer.y;
      pointerPending = false;
      const queuedChat = pendingLocalChat;
      pendingLocalChat = null;
      lastSent = now;
      // This runs in its own timer task, never in the pointer event or local
      // cursor's visual RAF. Anchor layout and transport serialization cannot
      // hold up the self-drawn pointer's transform update.
      const position = anchorFor(x, y, viewportMetrics);
      latestPointerAnchor = {
        x,
        y,
        position,
        revision: viewportMetrics.revision,
      };
      sendCursor({ t: 'cursor', a: position.anchor, fx: position.fx, fy: position.fy });
      if (queuedChat) {
        if (
          chatReplay &&
          chatReplay.session === queuedChat.snapshot.session &&
          chatReplay.seq === queuedChat.snapshot.seq
        ) {
          chatReplay.x = x;
          chatReplay.y = y;
        }
        const remaining = queuedChat.snapshot.expiresAt
          ? Math.max(1, queuedChat.snapshot.expiresAt - Date.now())
          : queuedChat.ttlMs;
        send(
          chatWirePayload(
            queuedChat.snapshot,
            Math.min(queuedChat.ttlMs, remaining),
            position
          )
        );
      }
      if (pointerPending || pendingLocalChat) {
        schedulePointer(performance.now());
      }
    }

    function reportPointer(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      latestPointer.x = Math.max(0, Math.min(viewportMetrics.width, x));
      latestPointer.y = Math.max(0, Math.min(viewportMetrics.height, y));
      pointerPending = true;
      // A high-polling-rate mouse can produce several events per display
      // frame. Once a trailing timer exists, only the latest coordinates
      // change — no repeated clock reads, interval math, or timer churn.
      if (pointerTimer !== null) return;
      schedulePointer(performance.now());
    }

    addEventListener(
      'pointermove',
      (e) => reportPointer(e.clientX, e.clientY),
      { passive: true }
    );

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      cancelPendingPointer();
      chatReplay = null;
      chatTrackingUntil = 0;
      send({ t: 'idle' });
    });

    // A cursor frozen mid-page reads as a bug; retract it when the pointer
    // actually leaves the window.
    document.documentElement.addEventListener('mouseleave', () => {
      cancelPendingPointer();
      chatReplay = null;
      chatTrackingUntil = 0;
      send({ t: 'idle' });
    });

    return {
      focus(card) {
        myFocus = card;
        send({ t: 'focus', card });
      },
      like(card, on) {
        if (!LIKE_CARDS.has(card) || typeof on !== 'boolean') return;
        const wasOn = myLikes.has(card);
        if (wasOn === on) return;

        likeCounts.set(
          card,
          Math.max(0, (likeCounts.get(card) || 0) + (on === wasOn ? 0 : on ? 1 : -1))
        );
        if (on) myLikes.add(card);
        else myLikes.delete(card);
        pendingLikes.set(card, on);
        persistMyLikes();
        notifyLike(card);

        if (transport !== 'pending') {
          transmitLike(card, on);
        }
      },
      say(text) {
        send({ t: 'bullet', text });
      },
      cursorChat({ session, seq, text, x, y, ttlMs = CHAT_TTL } = {}) {
        if (!CHAT_SESSION_RE.test(session || '') || !Number.isSafeInteger(seq) || seq <= 0) {
          return;
        }
        const safeText = normalizeChatText(text);
        const point = {
          x: Number.isFinite(x)
            ? Math.max(0, Math.min(viewportMetrics.width, x))
            : latestPointer.x,
          y: Number.isFinite(y)
            ? Math.max(0, Math.min(viewportMetrics.height, y))
            : latestPointer.y,
        };
        const ttl = Math.max(1, Math.min(CHAT_TTL, Number(ttlMs) || CHAT_TTL));
        const snapshot = { session, seq, text: safeText, ...point };

        if (safeText && safeText.trim() !== '') {
          snapshot.expiresAt = Date.now() + ttl;
          chatReplay = snapshot;
          const now = performance.now();
          chatTrackingUntil = now + ttl;
          pendingLocalChat = { snapshot, ttlMs: ttl };
          latestPointer.x = point.x;
          latestPointer.y = point.y;
          pointerPending = true;
          // Chat raises crowded rooms to at least 10Hz. It is the only event
          // allowed to pull an already-scheduled pointer trailing edge sooner.
          schedulePointer(now, true);
        } else {
          snapshot.text = '';
          chatReplay = null;
          chatTrackingUntil = 0;
          pendingLocalChat = null;
          // Clear remains immediate/latest-wins, but uses a cached or cheap
          // page anchor instead of synchronously hit-testing the input frame.
          send(chatWirePayload(snapshot, ttl, cachedAnchorFor(snapshot)));
        }
      },
      pointerMove(x, y) {
        reportPointer(x, y);
      },
      spray(on) {
        send({ t: 'spray', on: on ? 1 : 0 });
      },
      // Live screen position of a peer's rendered cursor — the fountain
      // erupts from here, so no extra coordinate traffic is ever needed.
      cursorPoint(id) {
        const c = cursors.get(String(id));
        if (!c || !c.placed || c.el.style.visibility === 'hidden') return null;
        return { x: c.x, y: c.y };
      },
    };
  }

  return { start };
})();
