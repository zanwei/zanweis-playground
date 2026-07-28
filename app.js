/**
 * zanwei's playground — gallery orchestration.
 * Builds the masonry from CATALOG, scales each repo demo into its card,
 * runs the playground modal, and wires cursor presence.
 */
'use strict';

(() => {
  const masonry = document.getElementById('masonry');

  // Hairline under the sticky topbar, only once content passes beneath it.
  const topbar = document.getElementById('topbar');
  new IntersectionObserver(([entry]) => {
    topbar.classList.toggle('is-stuck', !entry.isIntersecting);
  }).observe(document.querySelector('.top-sentinel'));

  const byModal = {
    root: document.getElementById('playground'),
    backdrop: document.getElementById('pg-backdrop'),
    window: document.querySelector('.playground-window'),
    title: document.getElementById('pg-title'),
    github: document.getElementById('pg-github'),
    close: document.getElementById('pg-close'),
    body: document.getElementById('pg-body'),
    frame: document.getElementById('pg-frame'),
    thumb: document.getElementById('pg-thumb'),
  };

  const tokenMs = (name, fallback) =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
  const quickMs = () => tokenMs('--duration-quick', 150);
  const fastMs = () => tokenMs('--duration-fast', 250);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const ARROW_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2.2" fill="none"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ------------------------------------------------------------- masonry

  // Previews hydrate only after the boot reveal lands (staggered, so eight
  // documents never parse in the same frame), and are frozen once settled —
  // they are inert, so a live rAF loop in a preview is pure main-thread cost.
  const previewFrames = [];

  function hydratePreviews() {
    if (hydratePreviews.done) return;
    hydratePreviews.done = true;
    previewFrames.forEach(({ frame, item }, i) => {
      setTimeout(() => {
        frame.src = demoUrl(item.demo);
      }, i * 150); // spread parses across the ~2s shuffle so it never hitches
    });
  }
  addEventListener('boot:hydrate', hydratePreviews, { once: true }); // shuffle cover
  addEventListener('boot:done', hydratePreviews, { once: true }); // boot-skip path
  setTimeout(hydratePreviews, 6500); // failsafe: boot.js never signalling

  function freezePreview(win) {
    // Park future rAF callbacks: loops stop scheduling work, canvases keep
    // their last frame, compositor-driven CSS animation continues.
    const queue = [];
    win.requestAnimationFrame = (cb) => queue.push(cb);
    win.cancelAnimationFrame = (id) => {
      if (id >= 1 && id <= queue.length) queue[id - 1] = null;
    };
  }

  // Card-click sound. Browsers cannot read the SYSTEM volume, so the loud-
  // volume guard is a first-click gate: the first click ever stays silent
  // and warns via toast; sound starts from the next click. Gain is capped
  // as a floor-level safety regardless.
  const clickSound = new Audio('assets/click.m4a'); // AAC: 9.6KB vs the 192KB wav
  clickSound.preload = 'auto';
  clickSound.volume = 0.5;

  function playClick() {
    let warned = false;
    try {
      warned = localStorage.getItem('zw-sound-warned') === '1';
    } catch {
      warned = true; // no storage: don't nag on every click
    }
    if (!warned) {
      try {
        localStorage.setItem('zw-sound-warned', '1');
      } catch {
        /* private mode */
      }
      Social.toast('Cards make a click sound — check your volume; it starts with your next click');
      return;
    }
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {
      /* autoplay policy or missing file — silence is fine */
    });
  }

  function buildCard(item, index) {
    const card = document.createElement('article');
    card.className = 'card enter';
    card.dataset.slug = item.slug;
    card.dataset.category = item.category;
    card.dataset.anchor = `card:${item.slug}`;
    card.style.setProperty(
      '--enter-delay',
      `${Math.min(index, 8) * tokenMs('--duration-stagger', 40)}ms`
    );

    if (item.type === 'figma') {
      // Figma cards preview as a vendored thumbnail — none of the live-demo
      // machinery (hydration, priming, freezing) applies. The playground
      // loads the real interactive embed on demand.
      card.innerHTML = `
        <div class="card-media" style="aspect-ratio: ${item.aspect}; background: ${item.bg}">
          <img class="figma-thumb" src="${item.thumb}" alt="" loading="lazy" />
          <button class="card-hit" aria-label="Open ${item.title} playground"></button>
          <div class="card-visitors"></div>
          <span class="card-label">${item.title}</span>
          <span class="card-open">${ARROW_SVG}</span>
        </div>`;
    } else {
      const [vw, vh] = item.viewport;
      card.innerHTML = `
      <div class="card-media" style="aspect-ratio: ${item.aspect}; background: ${item.bg}">
        <div class="card-frame" inert>
          <iframe title="${item.title} preview" loading="lazy"
            width="${vw}" height="${vh}"></iframe>
        </div>
        <button class="card-hit" aria-label="Open ${item.title} playground"></button>
        <div class="card-visitors"></div>
        <span class="card-label">${item.title}</span>
        <span class="card-open">${ARROW_SVG}</span>
      </div>`;

      const frame = card.querySelector('iframe');
      frame.addEventListener('load', () => {
        if (!frame.getAttribute('src')) return; // ignore the empty-frame load
        frame.classList.add('is-loaded');
        primePreview(item, frame);
      });
      previewFrames.push({ frame, item });

      // Scale the fixed design viewport to the card's real width.
      const media = card.querySelector('.card-media');
      new ResizeObserver(([entry]) => {
        const s = entry.contentRect.width / vw;
        frame.style.transform = `scale(${s})`;
      }).observe(media);
    }

    card.querySelector('.card-hit').addEventListener('click', () => {
      playClick();
      openPlayground(item);
    });
    // An interrupted entrance (animationcancel) must also shed the class, or
    // the card would replay it from opacity 0 the next time it renders.
    const settle = () => {
      card.classList.remove('enter');
      card.removeEventListener('animationend', settle);
      card.removeEventListener('animationcancel', settle);
    };
    card.addEventListener('animationend', settle);
    card.addEventListener('animationcancel', settle);
    return card;
  }

  async function primePreview(item, frame) {
    try {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!doc) return;
      if (item.previewCSS) {
        const style = doc.createElement('style');
        style.textContent = item.previewCSS;
        doc.head.appendChild(style);
      }
      if (item.tag && win.customElements) await win.customElements.whenDefined(item.tag);
      await new Promise((r) => setTimeout(r, 80));
      item.prime?.(doc);
      // A demo may grab focus as it boots (the dialog calls showModal + focus).
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('.card-frame')) ae.blur();
      // Let entrance animations settle, then stop the demo's clock.
      setTimeout(() => {
        try {
          freezePreview(win);
        } catch {
          /* frame may be gone */
        }
      }, 3500);
    } catch {
      /* previews are best-effort */
    }
  }

  CATALOG.forEach((item, i) => masonry.appendChild(buildCard(item, i)));

  // ---------------------------------------------------------- playground

  let openItem = null;
  let lastFocus = null;
  let closeTimer = null;
  const shell = document.querySelector('.shell');

  // matched-geometry helpers: the modal surface flies between the card's
  // rect and its own. Transform-only (translate + scale) so the flight runs
  // on the compositor; chips and iframe are hidden mid-flight, so the
  // non-uniform scale only ever stretches a solid surface.

  function cardMediaFor(slug) {
    return masonry.querySelector(`.card[data-slug="${CSS.escape(slug)}"] .card-media`);
  }

  // Every demo iframe src flows through here. An empty or root-resolving
  // value would load the site inside itself — a page within the page.
  function demoUrl(p) {
    return typeof p === 'string' && p.startsWith('components/') ? p : 'about:blank';
  }

  // What the playground iframe loads: a vendored demo, or (for figma cards)
  // the interactive embed — allow-listed to Figma's embed origin only.
  function playgroundUrl(item) {
    if (item.embed) {
      return item.embed.startsWith('https://embed.figma.com/') ? item.embed : 'about:blank';
    }
    return demoUrl(item.demo);
  }

  function flipTransform(from, to) {
    return `translate(${from.left - to.left}px, ${from.top - to.top}px)
      scale(${from.width / to.width}, ${from.height / to.height})`;
  }

  function layoutRect(el) {
    // Transform-free geometry: offset* metrics ignore the inline FLIP
    // transform, so interrupted flights still measure the resting box.
    // Valid for .playground-window because its offsetParent (.playground)
    // is fixed at inset 0 with no border.
    return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
  }

  let morphTimer = null;

  function openPlayground(item) {
    if (openItem?.slug === item.slug) return;
    clearTimeout(closeTimer);
    clearTimeout(morphTimer);
    // Capture the return target only on a fresh open — switching items while
    // the modal is up must not overwrite it with the close button.
    const isSwitch = Boolean(openItem);
    if (!openItem) lastFocus = document.activeElement;
    openItem = item;

    byModal.title.textContent = item.title;
    byModal.github.href = item.github;
    byModal.body.style.background = item.bg;
    byModal.frame.classList.remove('is-ready');
    byModal.body.classList.remove('is-live');

    // While a heavy embed boots, the modal shows the same thumbnail the card
    // did — landing continuity plus zero blank time. Live content crossfades
    // in over it when ready.
    if (item.thumb) {
      byModal.thumb.src = item.thumb;
      byModal.thumb.hidden = false;
    } else {
      byModal.thumb.hidden = true;
      byModal.thumb.removeAttribute('src');
    }

    // Cross-origin embeds parse in their own process — they cannot cost the
    // flight a single frame, so start their network time immediately. Only
    // same-origin demos wait for landing.
    if (item.embed) byModal.frame.src = playgroundUrl(item);

    byModal.root.hidden = false;
    byModal.root.classList.remove('is-closing');

    const win = byModal.window;
    const source = !isSwitch && !reduceMotion.matches && cardMediaFor(item.slug);
    if (source) {
      // FLIP: jump straight to the open state, then start the window at the
      // card's rect and let one transform transition carry it home. The demo
      // iframe loads only after landing — it is masked during the flight
      // anyway, and parsing it mid-flight costs main-thread frames.
      byModal.root.classList.add('is-open');
      win.classList.add('is-morphing');
      const first = source.getBoundingClientRect();
      const last = layoutRect(win);
      win.style.transformOrigin = '0 0';
      win.style.transition = 'none';
      win.style.transform = flipTransform(first, last);
      // Corners must match the card at takeoff (the scaled-down window's
      // visual radius would otherwise read too tight); eased back after
      // landing by the base border-radius transition.
      const scaleStart = first.width / last.width;
      win.style.borderRadius = `${Math.min(32, Math.round(tokenMs('--radius', 10) / scaleStart))}px`;
      void win.offsetWidth;
      win.style.transition = '';
      win.style.transform = '';
      morphTimer = setTimeout(() => {
        win.classList.remove('is-morphing');
        win.style.transformOrigin = '';
        win.style.borderRadius = ''; // ease home to the resting 12px
        if (openItem !== item) return;
        if (!item.embed) byModal.frame.src = playgroundUrl(item);
        // inert invalidates style for the whole shell subtree (8 iframe
        // documents) — never spend that on a flight-critical frame.
        shell.inert = true;
        byModal.close.focus({ preventScroll: true });
      }, fastMs() + 30);
    } else {
      if (!item.embed) byModal.frame.src = playgroundUrl(item);
      void byModal.root.offsetWidth; // commit hidden -> visible before transitioning
      byModal.root.classList.add('is-open');
      // aria-modal only claims the background is out of reach; inert makes it so.
      shell.inert = true;
      byModal.close.focus({ preventScroll: true });
    }

    if (location.hash.slice(1) !== item.slug) {
      history.replaceState(null, '', `#${item.slug}`);
    }
    presence?.focus(item.slug);
  }

  function closePlayground() {
    if (!openItem) return;
    const item = openItem;
    const source = !reduceMotion.matches && cardMediaFor(item.slug);
    openItem = null;
    clearTimeout(morphTimer);

    const win = byModal.window;
    if (source) {
      // Reverse flight, matched-geometry style: the SAME surface rides home
      // fully opaque with its content aboard — figma cards carry the card's
      // exact thumbnail, demos keep their live view (the mild stretch is
      // what sells "same element"). Only the chrome chips hide.
      win.classList.add('is-returning');
      const first = layoutRect(win);
      const target = source.getBoundingClientRect();
      // Static radius compensation: corners must MATCH THE CARD at landing.
      const scale = target.width / first.width;
      win.style.borderRadius = `${Math.min(32, Math.round(tokenMs('--radius', 10) / scale))}px`;
      if (item.embed) {
        // The embed's viewer chrome would stretch badly — swap to the
        // thumbnail (the card's own pixels) for the flight, instantly.
        byModal.frame.style.transition = 'none';
        byModal.frame.style.opacity = '0';
        byModal.thumb.hidden = false;
        byModal.body.classList.remove('is-live');
      }
      win.style.transformOrigin = '0 0';
      win.style.transform = flipTransform(target, first);
    }
    byModal.root.classList.add('is-closing');
    byModal.root.classList.remove('is-open');
    // The return flight runs the full --duration-fast; hide right at landing,
    // where the window exactly overlays the near-identical card.
    closeTimer = setTimeout(() => {
      byModal.root.hidden = true;
      byModal.root.classList.remove('is-closing');
      byModal.frame.src = 'about:blank';
      byModal.frame.style.transition = '';
      byModal.frame.style.opacity = '';
      byModal.thumb.hidden = true;
      byModal.thumb.removeAttribute('src');
      byModal.body.classList.remove('is-live');
      win.classList.remove('is-morphing', 'is-returning');
      win.style.transform = '';
      win.style.transformOrigin = '';
      win.style.borderRadius = '';
      // Un-inert after landing (same shell-wide style invalidation as open),
      // and only then hand focus back — focus() on an inert subtree is a no-op.
      shell.inert = false;
      lastFocus?.focus({ preventScroll: true });
      lastFocus = null;
    }, fastMs() + 40);

    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    presence?.focus(null);
  }

  byModal.frame.addEventListener('load', () => {
    if (!openItem) return;
    // A late load from a previous item (or about:blank) must not mark the
    // current frame ready — compare the document that actually loaded.
    if (openItem.embed) {
      // Cross-origin embed: contentWindow is sealed, so match the src
      // attribute we set ourselves.
      if (byModal.frame.getAttribute('src') !== openItem.embed) return;
    } else {
      try {
        if (!byModal.frame.contentWindow.location.pathname.endsWith(openItem.demo)) return;
      } catch {
        return;
      }
    }
    byModal.frame.classList.add('is-ready');
    byModal.body.classList.add('is-live'); // placeholder thumb yields to the live view
    // Keyboard focus lives inside the demo while the user plays with it, so
    // Escape must be caught in the iframe too (same origin).
    try {
      byModal.frame.contentWindow.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) closePlayground();
      });
    } catch {
      /* cross-origin demo: the header close button still works */
    }
  });
  byModal.close.addEventListener('click', closePlayground);
  byModal.backdrop.addEventListener('click', closePlayground);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openItem) closePlayground();
  });

  function syncToHash() {
    const slug = location.hash.slice(1);
    const item = CATALOG.find((c) => c.slug === slug);
    if (item) openPlayground(item);
    else closePlayground();
  }
  addEventListener('hashchange', syncToHash);

  // ------------------------------------------------------------ presence

  // The live count re-enters digit by digit when it changes (transitions.dev
  // number pop-in). The dot only breathes once someone else is here — with
  // nobody around there is no state worth signalling.
  const onlineEl = document.getElementById('online-count');
  const onlineBtn = document.getElementById('online-btn');
  let lastCount = null;

  function setOnlineCount(n) {
    if (n === lastCount) return; // never replay on a repeated value
    lastCount = n;
    onlineBtn?.toggleAttribute('data-company', n > 1);

    const chars = String(n).split('');
    onlineEl.classList.remove('is-animating');
    onlineEl.replaceChildren(
      ...chars.map((ch, i) => {
        const span = document.createElement('span');
        span.className = 't-digit';
        span.textContent = ch;
        // the last two digits ride 1x / 2x the stagger behind
        if (i === chars.length - 2) span.dataset.stagger = '1';
        else if (i === chars.length - 1) span.dataset.stagger = '2';
        return span;
      })
    );
    void onlineEl.offsetHeight; // reflow, so the animation replays
    onlineEl.classList.add('is-animating');
  }

  // Hold-L fountain: local sprays broadcast their on/off state; remote
  // sprays erupt from that peer's live cursor position.
  const fountain = Fountain.start({
    onState: (on) => presence?.spray(on),
  });

  const presence = Presence.start({
    loc: Social.location,
    onSelf: (self) => Social.onSelf(self),
    onLocations: (list) => Social.onLocations(list),
    onBullet: (b) => Social.onBullet(b),
    onSpray: ({ id, on }) => fountain.remoteSpray(id, on, () => presence.cursorPoint(id)),
    onCount(n) {
      setOnlineCount(n);
    },
    onFocus(list) {
      for (const holder of masonry.querySelectorAll('.card-visitors')) {
        holder.replaceChildren();
      }
      const perCard = new Map(); // cap dots per card — five reads as "a crowd"
      for (const { card, color } of list) {
        const n = (perCard.get(card) || 0) + 1;
        perCard.set(card, n);
        if (n > 5) continue;
        const holder = masonry.querySelector(
          `.card[data-slug="${CSS.escape(card)}"] .card-visitors`
        );
        if (!holder) continue;
        const dot = document.createElement('span');
        dot.style.background = color;
        holder.appendChild(dot);
      }
    },
  });

  Social.bind(presence);

  // Deep links resolve only after presence exists, so the focus broadcast
  // isn't lost (and a bad hash can't abort init).
  if (location.hash) syncToHash();
})();
