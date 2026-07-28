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
  const SEND_INTERVAL = 40; // ms between cursor reports (~25Hz), crowd-scaled
  const MAX_RENDERED = 30; // cursors drawn at once; beyond this they're noise
  const HEARTBEAT = 2000; // BroadcastChannel liveness ping
  const PEER_TIMEOUT = 5500;
  const IDLE_HIDE = 30000; // hide a cursor that hasn't moved in 30s
  // .is-leaving runs at --duration-quick; +30ms of slack before removal.
  const LEAVE_MS =
    (parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--duration-quick')
    ) || 150) + 30;
  const COLORS = ['orange', 'violet', 'green', 'pink', 'blue', 'amber'];

  // Peers announce a color NAME; the stylesheet owns the actual values.
  const cssColor = (c) => (c && c.startsWith('#') ? c : `var(--presence-${c || 'blue'})`);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // --- cursor rendering ----------------------------------------------------

  const CURSOR_SVG = `
    <svg width="24" height="24" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M5.09 5.36 10.48 20.73c.3.86 1.5.9 1.86.06l2.68-6.24a1 1 0 0 1 .52-.53l6.25-2.67c.83-.36.79-1.56-.07-1.87L6.36 4.09a1 1 0 0 0-1.27 1.27Z"
        fill="currentColor" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;

  class RemoteCursor {
    constructor(overlay, color) {
      this.el = document.createElement('div');
      this.el.className = 'presence-cursor';
      this.el.style.color = cssColor(color);
      this.el.innerHTML = `<div class="presence-cursor-inner">${CURSOR_SVG}</div>`;
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
    }

    setTarget(anchor, fx, fy) {
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
    }

    resolve() {
      if (!this.target) return null;
      const { anchor, fx, fy } = this.target;
      if (anchor === 'page') {
        // fx is a fraction of document width, fy an absolute document offset
        return { x: fx * document.documentElement.clientWidth - scrollX, y: fy - scrollY };
      }
      if (!this.anchorEl || !this.anchorEl.isConnected) {
        this.anchorEl = document.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
      }
      const rect = this.anchorEl && this.anchorEl.getBoundingClientRect();
      // A hidden or zero-area anchor means "this card isn't on screen here" —
      // hide the cursor rather than resolving it to the viewport corner.
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      return { x: rect.left + fx * rect.width, y: rect.top + fy * rect.height };
    }

    tick(now, dt, tau) {
      const p = this.resolve();
      if (!p || now - this.seenAt > IDLE_HIDE) {
        this.el.style.visibility = 'hidden';
        this.placed = false; // reappear with the pop-in, not a flight across
        this.el.classList.remove('is-in');
        return;
      }
      if (!this.placed) {
        // First (re)appearance: start at the target and pop in from the tip.
        this.x = p.x;
        this.y = p.y;
        this.placed = true;
        requestAnimationFrame(() => this.el.classList.add('is-in'));
      }
      // Exponential time-based damping: identical feel at 60/120/144Hz.
      // τ comes from the room's pace tier (tight in small rooms). Snap when
      // the viewer prefers reduced motion.
      const k = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / (tau || 51));
      this.x += (p.x - this.x) * k;
      this.y += (p.y - this.y) * k;
      const onScreen =
        this.x > -40 && this.y > -40 && this.x < innerWidth + 40 && this.y < innerHeight + 40;
      this.el.style.visibility = onScreen ? 'visible' : 'hidden';
      this.el.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    }

    leave(onDone) {
      // Scale back into the tip, then drop the node — revivable mid-fade.
      this.leaving = true;
      this.el.classList.remove('is-in');
      this.el.classList.add('is-leaving');
      this.leaveTimer = setTimeout(() => {
        this.el.remove();
        onDone();
      }, LEAVE_MS);
    }

    revive() {
      clearTimeout(this.leaveTimer);
      this.leaving = false;
      this.el.classList.remove('is-leaving');
      this.placed = false; // pops back in from the tip
    }
  }

  // --- anchor helpers ------------------------------------------------------

  function anchorFor(x, y) {
    const el = document.elementFromPoint(x, y);
    const host = el && el.closest('[data-anchor]');
    if (host) {
      const rect = host.getBoundingClientRect();
      return {
        anchor: host.dataset.anchor,
        fx: (x - rect.left) / rect.width,
        fy: (y - rect.top) / rect.height,
      };
    }
    return {
      anchor: 'page',
      fx: (x + scrollX) / document.documentElement.clientWidth,
      fy: y + scrollY,
    };
  }

  // --- main ----------------------------------------------------------------

  function start({ onCount, onFocus, onSelf, onLocations, onBullet, onSpray, loc } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'presence-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    // The crowd sets the pace: a small room runs a realtime tier (40Hz
    // reports, tight damping), bigger rooms lower their voice step by step.
    // Past 400 the cursor layer goes quiet — the count carries the story.
    let sendEvery = SEND_INTERVAL;
    let dampTau = 51; // ms; smaller = remote cursors track tighter
    function paceForCount(n) {
      if (n <= 12) {
        sendEvery = 25;
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
    let send = () => {};
    let myId = null;
    let myFocus = null; // replayed once the transport comes up (deep links)

    function notifyLocations() {
      if (onLocations) onLocations([...locations.values()]);
    }

    function peerCursor(id, color) {
      let c = cursors.get(id);
      if (!c) {
        // In a real crowd, arrows past the first few dozen are pure noise —
        // cap what we render; the count still tells the whole story.
        if (cursors.size >= MAX_RENDERED) return null;
        c = new RemoteCursor(overlay, color);
        cursors.set(id, c);
        ensureLoop();
      } else if (c.leaving) {
        c.revive(); // returning peer reuses the fading cursor, no duplicate
      }
      return c;
    }

    function dropPeer(id) {
      const c = cursors.get(id);
      if (c) c.leave(() => cursors.delete(id));
      if (focuses.delete(id) && onFocus) onFocus([...focuses.values()]);
      if (locations.delete(id)) notifyLocations();
    }

    function handle(msg) {
      switch (msg.t) {
        case 'cursor':
          peerCursor(msg.id, msg.color)?.setTarget(msg.a, msg.fx, msg.fy);
          break;
        case 'cursors':
          // Server tick frame: the latest position for every peer that moved.
          for (const e of msg.list || []) {
            if (String(e.id) === String(myId)) continue;
            peerCursor(e.id, e.color)?.setTarget(e.a, e.fx, e.fy);
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
        case 'idle': {
          // Backgrounded, not gone: retract the cursor, keep the location.
          const c = cursors.get(msg.id);
          if (c) c.leave(() => cursors.delete(msg.id));
          break;
        }
        case 'leave':
          dropPeer(msg.id);
          break;
      }
    }

    // render loop — parks itself when no cursors are on the page, restarted
    // by peerCursor(). dt drives frame-rate-independent damping.
    let rafId = null;
    let lastFrame = 0;
    function frame(now) {
      rafId = null;
      const dt = Math.min(250, now - (lastFrame || now));
      lastFrame = now;
      let stale = null;
      for (const [id, c] of cursors) {
        c.tick(now, dt, dampTau);
        // Long-hidden cursors leave the map entirely, so an idle room's
        // loop can park instead of ticking ghosts forever.
        if (!c.leaving && now - c.seenAt > IDLE_HIDE * 2) (stale ||= []).push(id);
      }
      if (stale) {
        for (const id of stale) {
          const c = cursors.get(id);
          if (c) c.leave(() => cursors.delete(id));
        }
      }
      if (cursors.size > 0) rafId = requestAnimationFrame(frame);
      else lastFrame = 0;
    }
    function ensureLoop() {
      if (rafId === null) rafId = requestAnimationFrame(frame);
    }

    // --- transport: SSE first, BroadcastChannel fallback -------------------

    // Transport ladder: WebSocket (the deployed Worker) -> SSE (`node
    // server.js` locally) -> BroadcastChannel (static hosting, tab-local).
    function startWS() {
      let ws;
      try {
        const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${scheme}://${location.host}/presence/ws`);
      } catch {
        startSSE();
        return;
      }
      let opened = false;

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'hello') {
          opened = true;
          myId = msg.id;
          if (onSelf) onSelf({ color: cssColor(msg.color), transport: 'ws' });
          for (const peer of msg.peers) {
            if (peer.last) handle({ ...peer.last, color: peer.color });
            if (peer.loc) handle({ t: 'loc', id: peer.id, color: peer.color, loc: peer.loc });
          }
          // The connection IS the identity — no id/token in the payload.
          send = (payload) => {
            if (ws.readyState === 1) ws.send(JSON.stringify(payload));
          };
          if (myFocus) send({ t: 'focus', card: myFocus });
          if (loc) send({ t: 'loc', loc });
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
        for (const id of [...cursors.keys()]) dropPeer(id);
        for (const id of [...focuses.keys()]) dropPeer(id);
        send = () => {};
        if (onCount) onCount(1);
        setTimeout(startWS, 1800);
      };
    }

    function startSSE() {
      const es = new EventSource('/presence/stream');
      let opened = false;
      let myToken = null;

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'hello') {
          opened = true;
          myId = msg.id;
          myToken = msg.token;
          if (onSelf) onSelf({ color: cssColor(msg.color), transport: 'sse' });
          for (const peer of msg.peers) {
            if (peer.last) handle({ ...peer.last, color: peer.color });
            if (peer.loc) handle({ t: 'loc', id: peer.id, color: peer.color, loc: peer.loc });
          }
          send = (payload) => {
            const body = JSON.stringify({ id: myId, token: myToken, ...payload });
            navigator.sendBeacon?.(
              '/presence/event',
              new Blob([body], { type: 'application/json' })
            ) || fetch('/presence/event', { method: 'POST', body, keepalive: true });
          };
          if (myFocus) send({ t: 'focus', card: myFocus });
          if (loc) send({ t: 'loc', loc });
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
        for (const id of [...cursors.keys()]) dropPeer(id);
        for (const id of [...focuses.keys()]) dropPeer(id);
        send = () => {};
        if (onCount) onCount(1);
      };
    }

    function startBroadcast() {
      let bc;
      try {
        bc = new BroadcastChannel('zw-playground-presence');
      } catch {
        if (onCount) onCount(1);
        if (onSelf) onSelf({ color: '#111114', transport: 'solo' });
        return;
      }
      myId = Math.random().toString(36).slice(2, 10);
      const myColor = COLORS[Math.abs([...myId].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % COLORS.length];
      if (onSelf) onSelf({ color: cssColor(myColor), transport: 'tabs' });
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

      send = (payload) => bc.postMessage({ id: myId, color: myColor, loc: loc || null, ...payload });
      send({ t: 'hb' });
      if (myFocus) send({ t: 'focus', card: myFocus });
      setInterval(() => {
        send({ t: 'hb' });
        census();
      }, HEARTBEAT);
      census();
    }

    if (location.protocol === 'file:') startBroadcast();
    else startWS();

    // --- local input -> reports --------------------------------------------

    let lastSent = 0;
    let pending = null;

    addEventListener(
      'pointermove',
      (e) => {
        // Store only raw coords; the hit-test (elementFromPoint + layout
        // read) runs at send rate, not pointermove rate.
        if (sendEvery === Infinity) return; // packed room: cursors go quiet
        pending = { x: e.clientX, y: e.clientY };
        const now = performance.now();
        if (now - lastSent >= sendEvery) {
          lastSent = now;
          const a = anchorFor(pending.x, pending.y);
          send({ t: 'cursor', a: a.anchor, fx: a.fx, fy: a.fy });
          pending = null;
        }
      },
      { passive: true }
    );

    // flush trailing position so cursors don't stop short
    setInterval(() => {
      if (pending && sendEvery !== Infinity && performance.now() - lastSent >= sendEvery) {
        lastSent = performance.now();
        const a = anchorFor(pending.x, pending.y);
        send({ t: 'cursor', a: a.anchor, fx: a.fx, fy: a.fy });
        pending = null;
      }
    }, 40); // trailing-flush granularity: tight enough for the realtime tier

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) send({ t: 'idle' });
    });

    // A cursor frozen mid-page reads as a bug; retract it when the pointer
    // actually leaves the window.
    document.documentElement.addEventListener('mouseleave', () => send({ t: 'idle' }));

    return {
      focus(card) {
        myFocus = card;
        send({ t: 'focus', card });
      },
      say(text) {
        send({ t: 'bullet', text });
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
