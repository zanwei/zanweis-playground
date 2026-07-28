/**
 * Social layer: the online-count globe and Figma-style cursor chat.
 *
 * Location is inferred from the timezone — continent-level on purpose. No
 * permission prompt, no network call, nothing precise enough to identify
 * anyone. Peers share {lat, lng, label} over the presence channel.
 *
 * The globe is cobe (github.com/shuding/cobe, vendored). Markers carry each
 * visitor's presence color; cobe's anchor divs position the tooltips, so
 * labels track the spinning globe with zero per-frame JS here.
 */
'use strict';

const Social = (() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // --- coarse location ------------------------------------------------------

  // Major-city refinements (dot placement), continent-level labels.
  const TZ = {
    'Asia/Shanghai': [31, 121, 'Asia'],
    'Asia/Hong_Kong': [22, 114, 'Asia'],
    'Asia/Taipei': [25, 121, 'Asia'],
    'Asia/Tokyo': [36, 140, 'Asia'],
    'Asia/Seoul': [37, 127, 'Asia'],
    'Asia/Singapore': [1, 104, 'Asia'],
    'Asia/Bangkok': [14, 100, 'Asia'],
    'Asia/Kolkata': [22, 79, 'Asia'],
    'Asia/Dubai': [25, 55, 'Asia'],
    'Asia/Jakarta': [-6, 107, 'Asia'],
    'Europe/London': [51, 0, 'Europe'],
    'Europe/Paris': [49, 2, 'Europe'],
    'Europe/Berlin': [52, 13, 'Europe'],
    'Europe/Madrid': [40, -4, 'Europe'],
    'Europe/Rome': [42, 12, 'Europe'],
    'Europe/Amsterdam': [52, 5, 'Europe'],
    'Europe/Moscow': [56, 38, 'Europe'],
    'America/New_York': [41, -74, 'North America'],
    'America/Chicago': [42, -88, 'North America'],
    'America/Denver': [40, -105, 'North America'],
    'America/Los_Angeles': [34, -118, 'North America'],
    'America/Vancouver': [49, -123, 'North America'],
    'America/Toronto': [44, -79, 'North America'],
    'America/Mexico_City': [19, -99, 'North America'],
    'America/Sao_Paulo': [-24, -47, 'South America'],
    'America/Argentina/Buenos_Aires': [-35, -58, 'South America'],
    'America/Bogota': [5, -74, 'South America'],
    'America/Lima': [-12, -77, 'South America'],
    'Africa/Cairo': [30, 31, 'Africa'],
    'Africa/Lagos': [6, 3, 'Africa'],
    'Africa/Nairobi': [-1, 37, 'Africa'],
    'Africa/Johannesburg': [-26, 28, 'Africa'],
    'Australia/Sydney': [-34, 151, 'Oceania'],
    'Australia/Melbourne': [-38, 145, 'Oceania'],
    'Pacific/Auckland': [-37, 175, 'Oceania'],
  };

  const REGION = {
    Asia: [30, 95, 'Asia'],
    Europe: [50, 15, 'Europe'],
    Africa: [2, 21, 'Africa'],
    America: [15, -90, 'the Americas'],
    Australia: [-26, 134, 'Oceania'],
    Pacific: [-8, -150, 'the Pacific Ocean'],
    Atlantic: [25, -35, 'the Atlantic Ocean'],
    Indian: [-8, 75, 'the Indian Ocean'],
    Antarctica: [-78, 0, 'Antarctica'],
  };

  function coarseLocation() {
    let tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      /* fall through to the ocean */
    }
    const hit = TZ[tz] || REGION[tz.split('/')[0]] || [20, 0, 'the Atlantic Ocean'];
    return { lat: hit[0], lng: hit[1], label: hit[2] };
  }

  const location = coarseLocation();

  // --- presence plumbing ----------------------------------------------------

  const PRESENCE_HEX = {
    orange: '#f5560c',
    violet: '#8c5bf0',
    green: '#0fa47a',
    pink: '#db3a80',
    blue: '#2b7fd9',
    amber: '#c99700',
  };

  const hexOf = (cssColor) => {
    const m = /--presence-(\w+)/.exec(cssColor || '');
    return (m && PRESENCE_HEX[m[1]]) || '#111114';
  };
  const rgb01 = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  let presence = null;
  let selfColor = '#111114';
  let peerLocations = [];

  // --- globe popover --------------------------------------------------------

  const btn = document.getElementById('online-btn');
  const pop = document.getElementById('globe-pop');
  const wrap = document.getElementById('globe-wrap');
  let globe = null;
  let popOpen = false;
  let closeTimer = null;
  let phi = 0;
  let focusPhi = 0;

  // From the cobe docs: angles that bring [lat, lng] to the front.
  const focusAngles = (lat, lng) => [
    Math.PI - ((lng * Math.PI) / 180 - Math.PI / 2),
    (lat * Math.PI) / 180,
  ];

  function markerList() {
    const markers = [
      { id: 'self', location: [location.lat, location.lng], size: 0.09, color: rgb01(hexOf(selfColor) === '#111114' ? '#f5560c' : hexOf(selfColor)) },
    ];
    peerLocations.forEach((p, i) => {
      // Past ~60 dots the globe is visually saturated — and each marker is
      // a cobe anchor div cobe repositions every frame.
      if (!p.loc || markers.length > 60) return;
      markers.push({
        id: `peer-${i}`,
        location: [p.loc.lat, p.loc.lng],
        size: 0.07,
        color: rgb01(hexOf(p.color)),
      });
    });
    return markers;
  }

  let chipRefs = []; // [{ chip, lng }] — visibility computed from phi per frame
  let chipRetry = null;

  // cobe creates its anchor divs on its own schedule; retry until they exist.
  function attachChipsSoon() {
    clearInterval(chipRetry);
    let tries = 0;
    chipRetry = setInterval(() => {
      attachChips();
      if (chipRefs.length > 0 || ++tries > 16 || !popOpen) {
        clearInterval(chipRetry);
      }
    }, 120);
  }

  function attachChips() {
    // Only the viewer gets a label — "You're here" riding the self anchor
    // (markers[0]). Peers stay as plain colored dots on the sphere.
    chipRefs = [];
    const anchors = [...wrap.querySelectorAll('div')].filter((d) => d.style.width === '1px');
    const anchor = anchors[0];
    if (!anchor) return;
    anchor.querySelector('.globe-chip')?.remove();
    const chip = document.createElement('span');
    chip.className = 'globe-chip';
    chip.textContent = 'You’re here';
    chip.style.visibility = 'hidden';
    anchor.appendChild(chip);
    chipRefs.push({ chip, lng: location.lng });
    updateChipVisibility(); // correct visibility before the first spin frame
  }

  function updateChipVisibility() {
    // A chip shows while its marker is on the front hemisphere.
    const shown = phi + dragOffset;
    for (const { chip, lng } of chipRefs) {
      const front = Math.cos(shown - focusAngles(0, lng)[0]);
      chip.style.visibility = front > 0.12 ? 'visible' : 'hidden';
    }
  }

  function openPop() {
    if (popOpen) return;
    popOpen = true;
    clearTimeout(closeTimer);
    pop.hidden = false;
    void pop.offsetWidth;
    pop.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');

    const size = 280 * Math.min(2, devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.style.width = '280px';
    canvas.style.height = '280px';
    wrap.replaceChildren(canvas);
    bindDrag(canvas);

    [focusPhi] = focusAngles(location.lat, location.lng);
    phi = focusPhi;
    const [, theta] = focusAngles(location.lat, location.lng);

    globe = window.createGlobe(canvas, {
      devicePixelRatio: Math.min(2, devicePixelRatio || 1),
      width: size,
      height: size,
      phi,
      theta: Math.max(0.1, theta * 0.7),
      dark: 0,
      diffuse: 1.2,
      mapSamples: 14000,
      mapBrightness: 5,
      baseColor: [0.92, 0.92, 0.93],
      markerColor: [0.96, 0.34, 0.05],
      glowColor: [1, 1, 1],
      markers: markerList(),
    });
    attachChipsSoon();
    spin();
  }

  // Drag-to-rotate, after the cobe interactive demo: the pointer drives a
  // rotation offset that eases in with damping, so a flick coasts to rest
  // instead of stopping dead. Idle spin pauses while the finger is down.
  let dragOffset = 0;
  let dragTarget = 0;
  let dragging = null; // pointer x at grab, minus the offset already applied

  function bindDrag(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      dragging = e.clientX - dragTarget * 140;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging === null) return;
      dragTarget = (e.clientX - dragging) / 140;
    });
    const release = () => {
      dragging = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  // cobe v2 has no onRender — drive the idle rotation ourselves, only while
  // the popover is open.
  let spinId = null;
  let spinLast = 0;
  function spin() {
    cancelAnimationFrame(spinId);
    spinLast = 0;
    const step = (now) => {
      if (!popOpen || !globe) return;
      const dt = Math.min(64, now - (spinLast || now));
      spinLast = now;
      if (!reduceMotion.matches && dragging === null) phi += 0.00017 * dt;
      // Damped approach: interruptible, carries a little momentum.
      const k = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / 90);
      dragOffset += (dragTarget - dragOffset) * k;
      globe.update({ phi: phi + dragOffset });
      updateChipVisibility();
      spinId = requestAnimationFrame(step);
    };
    spinId = requestAnimationFrame(step);
  }

  function closePop() {
    if (!popOpen) return;
    popOpen = false;
    pop.classList.remove('is-open');
    pop.classList.add('is-closing');
    btn.setAttribute('aria-expanded', 'false');
    cancelAnimationFrame(spinId);
    closeTimer = setTimeout(() => {
      pop.classList.remove('is-closing');
      pop.hidden = true;
      globe?.destroy(); // the globe never burns frames while closed
      globe = null;
      wrap.replaceChildren();
    }, 180);
  }

  if (btn && pop) {
    btn.addEventListener('click', () => (popOpen ? closePop() : openPop()));
    document.addEventListener('pointerdown', (e) => {
      if (popOpen && !pop.contains(e.target) && !btn.contains(e.target)) closePop();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popOpen) closePop();
    });
  }

  // --- bullet chat (press / to talk) ---------------------------------------
  //
  // Sent text crosses the screen left-to-right at constant speed (linear —
  // the one easing that's correct for steady motion). Hovering a bullet
  // pauses it so its Close button never runs away from the pointer.

  const BULLET_SPEED = 150; // px per second
  const LANE_TOP = 76;
  const LANE_STEP = 44;
  const LANE_COUNT = 6;
  let laneNext = 0;

  const bulletLayer = document.createElement('div');
  bulletLayer.className = 'bullet-layer';
  document.body.appendChild(bulletLayer);

  let bulletsOn = true;
  try {
    bulletsOn = localStorage.getItem('zw-bullets') !== '0';
  } catch {
    /* private mode: default on */
  }

  const CLOSE_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;

  // A message storm must degrade to a whisper, not a seizure: past the
  // on-screen cap, incoming bullets fold into a "+N" counter instead of
  // fighting for lanes. Your own message always shows.
  const MAX_ONSCREEN = 18;
  let suppressed = 0;
  let overflowEl = null;
  let overflowTimer = null;

  function noteSuppressed() {
    suppressed++;
    if (!overflowEl) {
      overflowEl = document.createElement('div');
      overflowEl.className = 'bullet-overflow';
      overflowEl.setAttribute('role', 'status');
      document.body.appendChild(overflowEl);
    }
    overflowEl.textContent = `+${suppressed} messages`;
    overflowEl.hidden = false;
    void overflowEl.offsetWidth;
    overflowEl.classList.add('is-on');
    clearTimeout(overflowTimer);
    overflowTimer = setTimeout(() => {
      overflowEl.classList.remove('is-on');
      suppressed = 0;
      setTimeout(() => {
        if (!overflowEl.classList.contains('is-on')) overflowEl.hidden = true;
      }, 220);
    }, 2200);
  }

  function spawnBullet(text, isOwn) {
    if (!bulletsOn || !text) return;
    if (!isOwn && bulletLayer.childElementCount >= MAX_ONSCREEN) {
      noteSuppressed();
      return;
    }
    const b = document.createElement('div');
    b.className = 'bullet' + (isOwn ? ' is-own' : '');
    const span = document.createElement('span');
    span.textContent = text; // user text: textContent only, never innerHTML
    const close = document.createElement('button');
    close.setAttribute('aria-label', 'Dismiss message');
    close.innerHTML = CLOSE_SVG;
    b.append(span, close);

    b.style.top = `${LANE_TOP + (laneNext++ % LANE_COUNT) * LANE_STEP}px`;
    bulletLayer.appendChild(b);
    const w = b.offsetWidth;
    b.style.left = `${-w - 8}px`;

    const remove = () => b.remove();
    if (reduceMotion.matches) {
      // No flight: rest near the left edge, fade after a readable pause.
      b.style.left = '24px';
      const idle = setTimeout(() => {
        b.classList.add('is-out');
        setTimeout(remove, 200);
      }, 6000);
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        clearTimeout(idle);
        remove();
        if (barOpen) barInput?.focus({ preventScroll: true });
      });
      return;
    }

    const distance = innerWidth + w + 16;
    b.style.setProperty('--fly', `${distance}px`);
    b.style.animationDuration = `${(distance / BULLET_SPEED).toFixed(2)}s`;
    b.addEventListener('animationend', remove);
    close.addEventListener('click', (e) => {
      // Dismissing a bullet is not "clicking away" from the composer — keep
      // the input focused so a burst of messages isn't interrupted.
      e.stopPropagation();
      b.classList.add('is-out'); // freeze via paused animation + pop out
      setTimeout(remove, 180);
      if (barOpen) barInput?.focus({ preventScroll: true });
    });
  }

  // Small status toast above the dock (e.g. "sent while display is off").
  let toastEl = null;
  let toastTimer = null;

  function showToast(text) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'chat-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.hidden = false;
    void toastEl.offsetWidth;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-on');
      setTimeout(() => {
        if (!toastEl.classList.contains('is-on')) toastEl.hidden = true;
      }, 220);
    }, 2400);
  }

  // Bottom input bar.
  let barEl = null;
  let barInput = null;
  let barOpen = false;

  function ensureBar() {
    if (barEl) return;
    barEl = document.createElement('div');
    barEl.className = 'chat-dock';
    barEl.innerHTML =
      `<div class="chat-bar">
        <input type="text" maxlength="120" placeholder="Say something" aria-label="Bullet chat message" />
        <button class="chat-send" aria-label="Send" disabled>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V6M6 12l6-6 6 6" stroke="currentColor" stroke-width="2.2" fill="none"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <button class="bullet-toggle" id="bullet-toggle" role="switch" aria-checked="true" title="Show bullet chat">
        <span class="bullet-toggle-label">Bullet chat</span>
        <span class="switch" aria-hidden="true"><span class="knob"></span></span>
      </button>`;
    barInput = barEl.querySelector('input');
    const sendBtn = barEl.querySelector('.chat-send');
    document.body.appendChild(barEl);
    wireToggle(barEl.querySelector('#bullet-toggle'));

    const doSend = () => {
      const text = barInput.value.trim();
      if (!text) return;
      presence?.say(text);
      spawnBullet(text, true);
      if (!bulletsOn) showToast('Bullet chat is off — flip the switch to see messages');
      barInput.value = '';
      sendBtn.disabled = true;
      barInput.focus({ preventScroll: true });
    };

    barInput.addEventListener('input', () => {
      sendBtn.disabled = barInput.value.trim() === '';
    });
    barInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeBar();
      } else if (e.key === 'Enter') {
        doSend();
      }
    });
    sendBtn.addEventListener('click', doSend);
    document.addEventListener('pointerdown', (e) => {
      if (!barOpen) return;
      // Dismissing a bullet (or hitting the display toggle) is part of the
      // chat surface — only a click on the page itself closes the composer.
      if (barEl.contains(e.target) || e.target.closest('.bullet, .bullet-toggle')) return;
      closeBar();
    });
  }

  function openBar() {
    ensureBar();
    barOpen = true;
    barEl.hidden = false;
    void barEl.offsetWidth;
    barEl.classList.add('is-on');
    barInput.focus({ preventScroll: true });
  }

  function closeBar() {
    if (!barOpen) return;
    barOpen = false;
    barInput.value = '';
    barEl.classList.remove('is-on');
    setTimeout(() => {
      if (!barOpen) barEl.hidden = true;
    }, 200);
  }

  addEventListener('keydown', (e) => {
    if (e.key !== '/' || barOpen) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    openBar();
  });

  // The display toggle lives next to the input bar (created with it).
  function wireToggle(toggleBtn) {
    if (!toggleBtn) return;
    const render = () => toggleBtn.setAttribute('aria-checked', String(bulletsOn));
    toggleBtn.addEventListener('click', () => {
      bulletsOn = !bulletsOn;
      try {
        localStorage.setItem('zw-bullets', bulletsOn ? '1' : '0');
      } catch {
        /* fine */
      }
      if (!bulletsOn) bulletLayer.replaceChildren();
      render();
    });
    render();
  }

  // Topbar hint chip: another way in, for people who never guess "/".
  document.getElementById('chat-hint')?.addEventListener('click', openBar);

  // --- wiring ---------------------------------------------------------------

  return {
    location,
    toast: showToast,
    bind(p) {
      presence = p;
    },
    onSelf({ color }) {
      selfColor = color;
      if (globe) globe.update({ markers: markerList() });
    },
    onLocations(list) {
      peerLocations = list;
      if (globe) {
        globe.update({ markers: markerList() });
        attachChipsSoon();
      }
    },
    onBullet({ text }) {
      spawnBullet(text, false);
    },
  };
})();
