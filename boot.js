/**
 * Boot loader — the shuffling-face intro from demo.gif, light-theme port.
 *
 * Sequence:
 *   1. A 3×3 grid of pixel faces. Every 500ms each cell switches expression,
 *      looping once through the four moods — smile, frown, surprised,
 *      deadpan — in its own random order with its own random variant.
 *   2. All faces settle on the smile with one subtle pop.
 *   3. The sheet eases into a center scale-down while a dim overlay fades in
 *      over it (0 → 100), then the page pulls up from the bottom like a
 *      drawer and covers it.
 *   4. The card entrance stagger plays only after the drawer lands.
 *
 * The wordmark is the same face; it follows the boot shuffle, then advances
 * one expression per hover.
 */
'use strict';

(() => {
  const HAPPY = 4; // index of the clear smile in FACE_PATHS
  const SETTLE_HOLD = 350; // beat on the smile before the reveal starts
  const OVERLAY_LEAD = 250; // scale-down + dim runs alone before the drawer
  const html = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const tokenMs = (name, fallback) =>
    parseFloat(getComputedStyle(html).getPropertyValue(name)) || fallback;
  const BEAT = tokenMs('--boot-beat', 500); // one expression switch per beat
  const REVEAL = tokenMs('--duration-reveal', 900);

  // The four moods across the nine faces.
  const MOODS = [
    [4, 6, 8], // smile
    [0, 2], // frown
    [3, 7], // surprised
    [1, 5], // deadpan
  ];

  const boot = document.getElementById('boot');
  const grid = document.getElementById('boot-grid');
  const sheet = document.getElementById('sheet'); // the full-bleed drawer surface
  const brandFace = document.querySelector('.brand-face path');

  function releaseEverything() {
    clearTimeout(window.__bootFailsafe);
    html.classList.remove('booting', 'revealing');
    boot?.setAttribute('data-hidden', '');
    scrollTo(0, 0); // never land holding an offset from the doubled document
    dispatchEvent(new Event('boot:done')); // previews hydrate from here
  }

  // A window resize mid-intro changes 100dvh under a running transform: the
  // drawer's start and end no longer agree and transitionend can fire early
  // or not at all, which would strand the sheet off-screen. Someone resizing
  // the window is done watching the intro anyway — land it immediately.
  addEventListener(
    'resize',
    () => {
      if (html.classList.contains('booting') || html.classList.contains('revealing')) {
        releaseEverything();
        scrollTo(0, 0);
      }
    },
    { passive: true }
  );

  // faces.js may be absent if something went wrong — fail open.
  if (!boot || typeof FACE_PATHS === 'undefined') {
    releaseEverything();
    return;
  }

  // --- wordmark wiring (always active, boot or not) ------------------------

  const brand = document.querySelector('.brand');
  if (brandFace) brandFace.setAttribute('d', FACE_PATHS[HAPPY]);
  if (brand) {
    // A brand click is "refresh, skip the intro" — one-shot flag.
    brand.addEventListener('click', () => {
      try {
        sessionStorage.setItem('zw-skip-boot', '1');
      } catch {
        /* private mode: the intro just plays again */
      }
    });
    if (brandFace && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      let face = HAPPY;
      brand.addEventListener('mouseenter', () => {
        face = (face + 1) % 9;
        brandFace.setAttribute('d', FACE_PATHS[face]);
      });
    }
  }

  // Brand-click refresh: no intro at all.
  if (html.classList.contains('boot-skip')) {
    releaseEverything();
    return;
  }

  const cells = [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('span');
    cell.className = 'boot-cell';
    cell.innerHTML = `<svg viewBox="${FACE_VIEWBOX}" aria-hidden="true"><path d="${FACE_PATHS[i]}"/></svg>`;
    grid.appendChild(cell);
    cells.push(cell.querySelector('path'));
  }

  // Each cell loops once through the four moods in its own random order,
  // with a random face variant per mood.
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffled = () => {
    const order = [...MOODS];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order.map(pick);
  };
  const loops = cells.map(shuffled); // loops[cell] = 4 face indices

  function setStep(step) {
    for (let i = 0; i < 9; i++) cells[i].setAttribute('d', FACE_PATHS[loops[i][step]]);
    if (brandFace) brandFace.setAttribute('d', FACE_PATHS[loops[4][step]]);
  }

  function settle() {
    for (const c of cells) c.setAttribute('d', FACE_PATHS[HAPPY]);
    if (brandFace) brandFace.setAttribute('d', FACE_PATHS[HAPPY]);
    grid.setAttribute('data-settled', ''); // one subtle pop (CSS)
  }

  function reveal() {
    clearTimeout(window.__bootFailsafe);
    boot.setAttribute('data-done', ''); // center scale-down + overlay 0 -> 100
    setTimeout(() => {
      html.classList.remove('booting');
      html.classList.add('revealing'); // the drawer pulls up from the bottom
      // transitionend BUBBLES: a child transition finishing mid-flight (the
      // topbar hairline, a chip) must not cut the drawer short — only the
      // sheet's own transform counts.
      const land = (e) => {
        if (e && (e.target !== sheet || e.propertyName !== 'transform')) return;
        sheet.removeEventListener('transitionend', land);
        clearTimeout(fallback);
        html.classList.remove('revealing');
        boot.setAttribute('data-hidden', '');
        // Any offset picked up while the document was double-height (a late
        // scroll restore, an anchor) would leave the landed page mid-air.
        scrollTo(0, 0);
        dispatchEvent(new Event('boot:done')); // previews hydrate from here
      };
      sheet.addEventListener('transitionend', land);
      const fallback = setTimeout(land, REVEAL + 200);
    }, OVERLAY_LEAD);
  }

  if (reduce) {
    settle();
    setTimeout(() => {
      boot.setAttribute('data-done', '');
      releaseEverything();
    }, 200);
    return;
  }

  let step = 0;
  setStep(0);
  const timer = setInterval(() => {
    step++;
    if (step < 4) {
      setStep(step); // steps 1-3 complete the one loop through the moods
      return;
    }
    clearInterval(timer);
    settle();
    setTimeout(reveal, SETTLE_HOLD);
  }, BEAT);
})();
