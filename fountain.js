/**
 * Fountain — hold L to spray hearts, stars and thumbs from the cursor.
 *
 * A pooled particle system: fixed element pool, physics integrated in one
 * rAF loop, transform/opacity only, parked when idle. Launch velocity points
 * up with spread; gravity brings each sprite to its apex where it fades out.
 *
 * Multiplayer: only the on/off STATE is broadcast — remote particles erupt
 * from that peer's live cursor position, which is already streaming. Beyond
 * MAX_REMOTE_SPRAYERS simultaneous remote sprays, new ones are not rendered:
 * your own fountain always wins the frame budget.
 */
'use strict';

const Fountain = (() => {
  const SPRITES = ['assets/heart.svg', 'assets/star.svg', 'assets/thumb.svg'];
  const POOL_MAX = 64; // hard ceiling on live particle elements
  const SELF_MAX = 26; // your fountain's share of the pool
  const REMOTE_MAX_EACH = 8; // per remote sprayer
  const MAX_REMOTE_SPRAYERS = 3; // beyond this, sprays are self-only
  const SELF_RATE = 42; // particles/sec while holding
  const REMOTE_RATE = 12; // remote fountains are ambience, not fireworks
  const G = 1500; // px/s²
  const REMOTE_TTL = 2500; // ms without a heartbeat before a spray expires

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let layer = null;
  const freeP = [];
  const active = [];
  let poolCount = 0;
  const owned = new Map(); // owner -> live particle count

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement('div');
    layer.className = 'fountain-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }

  function takeParticle() {
    if (freeP.length) return freeP.pop();
    if (poolCount >= POOL_MAX) return null;
    poolCount++;
    ensureLayer();
    const el = document.createElement('div');
    el.className = 'fountain-p';
    el.innerHTML = '<img alt="" draggable="false" />';
    layer.appendChild(el);
    return { el, img: el.querySelector('img'), src: '' };
  }

  function launch(owner, max, x, y, driftVx) {
    if ((owned.get(owner) || 0) >= max) return;
    const p = takeParticle();
    if (!p) return;
    const src = SPRITES[(Math.random() * SPRITES.length) | 0];
    if (p.src !== src) {
      p.src = src;
      p.img.src = src; // usually a cache hit — three bitmaps total
    }
    p.owner = owner;
    p.x = x;
    p.y = y;
    // A real jet: mostly up, a little sideways, a touch of hand motion.
    p.vx = (Math.random() - 0.5) * 240 + driftVx * 0.25;
    p.vy = -(520 + Math.random() * 280);
    p.rot = Math.random() * 360;
    p.spin = (Math.random() - 0.5) * 1080; // deg/s, either direction
    p.scale = 0.5 + Math.random() * 0.5;
    p.t = 0;
    p.life = (-p.vy / G) * 1.18; // dies just past its apex
    p.el.style.opacity = '1';
    p.el.style.visibility = 'visible';
    active.push(p);
    owned.set(owner, (owned.get(owner) || 0) + 1);
    ensureLoop();
  }

  function recycle(i) {
    const p = active[i];
    active[i] = active[active.length - 1];
    active.pop();
    p.el.style.visibility = 'hidden';
    owned.set(p.owner, (owned.get(p.owner) || 1) - 1);
    freeP.push(p);
  }

  // --- local input -----------------------------------------------------------

  let held = false;
  let emitAcc = 0;
  let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  let mouseVx = 0;
  let lastMoveT = 0;
  let onState = null;

  function setHeld(on) {
    if (held === on) return;
    held = on;
    emitAcc = 0;
    lastMoveT = 0;
    mouseVx = 0;
    if (onState) onState(on);
  }

  // --- remote sprayers -------------------------------------------------------

  const remotes = new Map(); // id -> { pointFn, until, acc }

  function remoteSpray(id, on, pointFn) {
    if (reduceMotion.matches) return;
    const key = String(id);
    if (!on) {
      remotes.delete(key);
      return;
    }
    if (!remotes.has(key) && remotes.size >= MAX_REMOTE_SPRAYERS) {
      return; // crowded: their spray stays on their screen, not yours
    }
    const r = remotes.get(key) || { acc: 0 };
    r.pointFn = pointFn;
    r.until = performance.now() + REMOTE_TTL;
    remotes.set(key, r);
    ensureLoop();
  }

  // --- the loop --------------------------------------------------------------

  let rafId = null;
  let lastT = 0;

  function frame(now) {
    rafId = null;
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
    lastT = now;

    if (held) {
      emitAcc += dt;
      const step = 1 / SELF_RATE;
      while (emitAcc >= step) {
        emitAcc -= step;
        launch('self', SELF_MAX, mouse.x, mouse.y, mouseVx);
      }
    }

    for (const [id, r] of remotes) {
      if (now > r.until) {
        remotes.delete(id);
        continue;
      }
      const pt = r.pointFn();
      if (!pt) continue;
      r.acc += dt;
      const step = 1 / REMOTE_RATE;
      while (r.acc >= step) {
        r.acc -= step;
        launch(id, REMOTE_MAX_EACH, pt.x, pt.y, 0);
      }
    }

    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      p.t += dt;
      if (p.t >= p.life) {
        recycle(i);
        continue;
      }
      p.vy += G * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      const k = p.t / p.life;
      p.el.style.opacity = k > 0.68 ? String(1 - (k - 0.68) / 0.32) : '1';
      p.el.style.transform =
        `translate3d(${p.x}px, ${p.y}px, 0) rotate(${p.rot}deg) scale(${p.scale})`;
    }

    if (active.length || held || remotes.size) {
      rafId = requestAnimationFrame(frame);
    } else {
      lastT = 0;
    }
  }

  function ensureLoop() {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }

  // --- wiring ----------------------------------------------------------------

  function start(opts = {}) {
    if (reduceMotion.matches) {
      // A pure-motion toy — under reduced motion it simply doesn't exist.
      return { remoteSpray: () => {} };
    }
    onState = opts.onState || null;

    addEventListener(
      'pointermove',
      (e) => {
        if (!held) {
          mouse.x = e.clientX;
          mouse.y = e.clientY;
          return;
        }
        const now = performance.now();
        const dtm = now - (lastMoveT || now);
        if (dtm > 0) mouseVx = ((e.clientX - mouse.x) / dtm) * 1000;
        lastMoveT = now;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
      },
      { passive: true }
    );

    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyL' || e.repeat || e.metaKey || e.ctrlKey) return;
      // Plain L is also a letter — never steal it from someone typing.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setHeld(true);
      // opening burst — a jet starts with a spurt, not a trickle
      for (let i = 0; i < 7; i++) launch('self', SELF_MAX, mouse.x, mouse.y, mouseVx);
      ensureLoop();
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyL') setHeld(false);
    });
    addEventListener('blur', () => setHeld(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) setHeld(false);
    });

    // Re-announce while holding so late joiners and dropped packets recover
    // (remote side expires sprays after REMOTE_TTL without a refresh).
    setInterval(() => {
      if (held && onState) onState(true);
    }, 1500);

    return { remoteSpray };
  }

  return { start };
})();
