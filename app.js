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
    video: document.getElementById('pg-video'),
  };

  const tokenMs = (name, fallback) =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
  const quickMs = () => tokenMs('--duration-quick', 150);
  const fastMs = () => tokenMs('--duration-fast', 250);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const hoverPlayback = matchMedia('(hover: hover) and (pointer: fine)');
  const connection = navigator.connection;
  const touchDevice = navigator.maxTouchPoints > 0;
  const prefersDataSaving = () => Boolean(connection?.saveData);
  const canPlayVideo = () =>
    !touchDevice &&
    hoverPlayback.matches &&
    !reduceMotion.matches &&
    !prefersDataSaving();
  const VIDEO_HOVER_INTENT_MS = 150;

  const ARROW_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2.2" fill="none"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ------------------------------------------------------------- masonry

  // Previews hydrate only after the boot reveal lands (staggered, so eight
  // documents never parse in the same frame), and are frozen once settled —
  // they are inert, so a live rAF loop in a preview is pure main-thread cost.
  const previewFrames = [];
  let presence = null;

  const LIKE_NUMBER_MS = 180;
  const LIKE_BURST_MS = 500;
  const likeNumberTimers = new WeakMap();
  const likeBurstTimers = new WeakMap();

  function likeCount(value, fallback = 0) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : fallback;
  }

  function likeNumber(value, state = '') {
    const number = document.createElement('span');
    number.className = `card-like-number${state ? ` ${state}` : ''}`;
    number.textContent = String(value);
    return number;
  }

  function updateLikeLabel(button, count, on) {
    const title = button.dataset.likeTitle || 'card';
    const noun = count === 1 ? 'like' : 'likes';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', `${on ? 'Unlike' : 'Like'} ${title}, ${count} ${noun}`);
  }

  function renderLikeButton(button, count, on, animate) {
    if (!button) return;
    const previous = likeCount(button.dataset.likeCount);
    const next = likeCount(count, previous);
    const pressed = typeof on === 'boolean' ? on : button.getAttribute('aria-pressed') === 'true';
    const holder = button.querySelector('.card-like-count');

    updateLikeLabel(button, next, pressed);
    button.toggleAttribute('data-has-count', next > 0);
    if (!holder) {
      button.dataset.likeCount = String(next);
      return;
    }

    if (!animate) {
      clearTimeout(likeNumberTimers.get(button));
      likeNumberTimers.delete(button);
      holder.hidden = next === 0;
      holder.replaceChildren(...(next > 0 ? [likeNumber(next)] : []));
    } else if (next !== previous) {
      clearTimeout(likeNumberTimers.get(button));
      const leaving = previous > 0 ? likeNumber(previous) : null;
      const entering = next > 0 ? likeNumber(next, 'is-entering') : null;
      holder.hidden = false;
      holder.replaceChildren(...[leaving, entering].filter(Boolean));
      void holder.offsetWidth;
      leaving?.classList.add('is-leaving');
      entering?.classList.remove('is-entering');
      const timer = setTimeout(() => {
        if (button.dataset.likeCount !== String(next)) return;
        holder.hidden = next === 0;
        holder.replaceChildren(...(entering ? [entering] : []));
        likeNumberTimers.delete(button);
      }, LIKE_NUMBER_MS);
      likeNumberTimers.set(button, timer);
    }
    button.dataset.likeCount = String(next);
  }

  function mineIncludes(mine, slug) {
    if (Array.isArray(mine)) return mine.includes(slug);
    if (mine instanceof Set) return mine.has(slug);
    return Boolean(mine && typeof mine === 'object' && mine[slug]);
  }

  function snapshotCount(counts, slug) {
    if (counts instanceof Map) return counts.get(slug);
    if (counts && typeof counts === 'object') return counts[slug];
    return 0;
  }

  function renderLikeSnapshot({ counts, mine } = {}) {
    for (const card of masonry.querySelectorAll('.card[data-slug]')) {
      const slug = card.dataset.slug;
      renderLikeButton(
        card.querySelector('.card-like'),
        snapshotCount(counts, slug),
        mineIncludes(mine, slug),
        false
      );
    }
  }

  function renderLikeChange({ card, count, on } = {}) {
    if (typeof card !== 'string' || !card) return;
    const button = masonry.querySelector(
      `.card[data-slug="${CSS.escape(card)}"] .card-like`
    );
    renderLikeButton(button, count, on, true);
  }

  function createLikeButton(item) {
    const button = document.createElement('button');
    button.className = 'card-like';
    button.type = 'button';
    button.dataset.likeTitle = item.title;
    button.dataset.likeCount = '0';

    const unlike = document.createElement('img');
    unlike.className = 'card-like-icon card-like-icon-unliked';
    unlike.src = 'assets/unlike.svg';
    unlike.alt = '';
    unlike.setAttribute('aria-hidden', 'true');
    unlike.draggable = false;

    const liked = document.createElement('img');
    liked.className = 'card-like-icon card-like-icon-liked';
    liked.src = 'assets/liked.svg';
    liked.alt = '';
    liked.setAttribute('aria-hidden', 'true');
    liked.draggable = false;

    const icons = document.createElement('span');
    icons.className = 'card-like-icons';
    icons.setAttribute('aria-hidden', 'true');
    const burst = document.createElement('span');
    burst.className = 'card-like-burst';
    burst.append(
      ...Array.from({ length: 9 }, () => {
        const particle = document.createElement('span');
        particle.className = 'card-like-particle';
        return particle;
      })
    );
    icons.append(burst, unlike, liked);

    const count = document.createElement('span');
    count.className = 'card-like-count';
    count.setAttribute('aria-hidden', 'true');
    count.hidden = true;
    button.append(icons, count);
    updateLikeLabel(button, 0, false);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const nextOn = button.getAttribute('aria-pressed') !== 'true';
      updateLikeLabel(button, likeCount(button.dataset.likeCount), nextOn);
      if (nextOn && !reduceMotion.matches) {
        clearTimeout(likeBurstTimers.get(icons));
        icons.classList.remove('is-celebrating');
        void icons.offsetWidth;
        icons.classList.add('is-celebrating');
        likeBurstTimers.set(
          icons,
          setTimeout(() => {
            icons.classList.remove('is-celebrating');
            likeBurstTimers.delete(icons);
          }, LIKE_BURST_MS)
        );
      }
      presence?.like(item.slug, nextOn);
    });
    return button;
  }

  function hydratePreviews() {
    if (hydratePreviews.done) return;
    hydratePreviews.done = true;
    previewFrames.forEach(({ frame, item }, i) => {
      setTimeout(() => {
        frame.src = demoUrl(item.demo);
      }, i * 150); // spread post-reveal parses so they never share one frame
    });
  }
  addEventListener('boot:done', hydratePreviews, { once: true });
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

  // Card-click sound. Decode the tiny asset before the first interaction so
  // the first card gets the same low-latency response as every later card.
  // HTMLAudio stays as a compatibility fallback when Web Audio is unavailable.
  const CLICK_SOUND_URL = 'assets/click.m4a'; // AAC: 9.6KB vs the 192KB wav
  const clickSound = new Audio(CLICK_SOUND_URL);
  clickSound.preload = 'auto';
  clickSound.volume = 0.5;
  clickSound.load();

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let clickAudioContext = null;
  let clickAudioGain = null;
  let clickAudioBuffer = null;

  if (AudioContextClass) {
    try {
      clickAudioContext = new AudioContextClass({ latencyHint: 'interactive' });
      clickAudioGain = clickAudioContext.createGain();
      clickAudioGain.gain.value = 0.5;
      clickAudioGain.connect(clickAudioContext.destination);
      fetch(CLICK_SOUND_URL)
        .then((response) => {
          if (!response.ok) throw new Error(`Click sound returned ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => clickAudioContext.decodeAudioData(data))
        .then((buffer) => {
          clickAudioBuffer = buffer;
        })
        .catch(() => {
          clickAudioBuffer = null;
        });
    } catch {
      clickAudioContext = null;
      clickAudioGain = null;
    }
  }

  function unlockClickAudio() {
    if (clickAudioContext?.state !== 'suspended') return;
    clickAudioContext.resume().catch(() => {
      /* the HTMLAudio fallback remains available */
    });
  }

  addEventListener('pointerdown', unlockClickAudio, { capture: true, passive: true });
  addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' || event.key === ' ') unlockClickAudio();
    },
    { capture: true }
  );

  function playFallbackClick() {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {
      /* autoplay policy or missing file — silence is fine */
    });
  }

  function playClick() {
    if (clickAudioContext && clickAudioGain && clickAudioBuffer) {
      const start = () => {
        const source = clickAudioContext.createBufferSource();
        source.buffer = clickAudioBuffer;
        source.connect(clickAudioGain);
        source.start();
      };
      if (clickAudioContext.state === 'running') {
        start();
      } else {
        clickAudioContext.resume().then(start).catch(playFallbackClick);
      }
      return;
    }
    playFallbackClick();
  }

  function buildCard(item, index) {
    const card = document.createElement('article');
    let releaseCardVideo = null;
    card.className = 'card enter';
    card.dataset.slug = item.slug;
    card.dataset.category = item.category;
    card.dataset.anchor = `card:${item.slug}`;
    card.style.setProperty(
      '--enter-delay',
      `${Math.min(index, 8) * tokenMs('--duration-stagger', 40)}ms`
    );

    if (item.type === 'figma' || item.type === 'image') {
      // Static studies stay lightweight everywhere: the card and playground
      // share one vendored image, while Source opens the original project.
      card.innerHTML = `
        <div class="card-media" style="aspect-ratio: ${item.aspect}; background: ${item.bg}">
          <img class="static-thumb" src="${item.thumb}" alt="" loading="lazy" />
          <button class="card-hit" aria-label="Open ${item.title} playground"></button>
          <div class="card-visitors"></div>
          <span class="card-label">${item.title}</span>
          <span class="card-open">${ARROW_SVG}</span>
        </div>`;
    } else if (item.type === 'video') {
      card.innerHTML = `
        <div class="card-media card-media-video"
          style="aspect-ratio: ${item.aspect}; background: ${item.bg}">
          <video class="video-thumb" poster="${item.poster}"
            preload="none" muted playsinline aria-hidden="true"></video>
          <button class="card-hit" aria-label="Open ${item.title} playground"></button>
          <div class="card-visitors"></div>
          <span class="card-label">${item.title}</span>
          <span class="card-open">${ARROW_SVG}</span>
        </div>`;

      const media = card.querySelector('.card-media');
      const video = card.querySelector('.video-thumb');
      let hoverIntentTimer = null;

      const releaseVideo = () => {
        clearTimeout(hoverIntentTimer);
        hoverIntentTimer = null;
        video.pause();
        if (video.hasAttribute('src')) {
          video.removeAttribute('src');
          video.load();
        }
      };
      const playPreview = () => {
        hoverIntentTimer = null;
        if (!canPlayVideo() || !media.matches(':hover')) return;
        if (!video.hasAttribute('src')) {
          video.src = item.previewVideo;
          video.load();
        }
        if (video.ended) video.currentTime = 0;
        video.play().catch(() => {
          /* a browser may still decline playback; the poster remains visible */
        });
      };

      media.addEventListener('mouseenter', () => {
        if (!canPlayVideo()) return;
        clearTimeout(hoverIntentTimer);
        hoverIntentTimer = setTimeout(playPreview, VIDEO_HOVER_INTENT_MS);
      });
      media.addEventListener('mouseleave', releaseVideo);
      video.addEventListener('error', releaseVideo);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) releaseVideo();
      });
      reduceMotion.addEventListener('change', (event) => {
        if (event.matches) releaseVideo();
      });
      hoverPlayback.addEventListener('change', (event) => {
        if (!event.matches) releaseVideo();
      });
      connection?.addEventListener?.('change', () => {
        if (prefersDataSaving()) releaseVideo();
      });
      releaseCardVideo = releaseVideo;
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

    card.querySelector('.card-media').appendChild(createLikeButton(item));
    card.querySelector('.card-hit').addEventListener('click', () => {
      releaseCardVideo?.();
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
  let playgroundEpoch = 0;
  let playgroundFrameBridge = null;
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

  // Only the repo demos load in the playground iframe. Static explorations
  // are rendered by the image layer instead.
  function playgroundUrl(item) {
    return demoUrl(item.demo);
  }

  function disposePlaygroundFrameBridge(frame = null) {
    const bridge = playgroundFrameBridge;
    if (!bridge || (frame && bridge.frame !== frame)) return;
    bridge.dispose();
    if (playgroundFrameBridge === bridge) playgroundFrameBridge = null;
  }

  function markPlaygroundFrameReady(frame, item, expected, epoch) {
    if (epoch !== playgroundEpoch || frame !== byModal.frame || openItem !== item) return;
    if (frame.getAttribute('src') !== expected) return;
    let frameDocument;
    try {
      if (!frame.contentWindow.location.pathname.endsWith(item.demo)) return;
      frameDocument = frame.contentDocument;
    } catch {
      return;
    }
    if (!frameDocument?.documentElement) return;

    // Pointer and keyboard events do not bubble out of an iframe. Bridge the
    // same-origin playground into the page-level cursor/chat handlers so the
    // canvas still behaves like one shared surface.
    try {
      const frameWindow = frame.contentWindow;
      const existingBridge = playgroundFrameBridge;
      if (
        existingBridge?.frame === frame &&
        existingBridge.frameDocument === frameDocument
      ) {
        existingBridge.refreshGeometry();
        Social.syncCustomCursor?.(frame);
        frame.classList.add('is-ready');
        byModal.body.classList.add('is-live');
        return;
      }

      disposePlaygroundFrameBridge();

      let framePointer = null;
      const chatPendingOwner = {};
      let disposed = false;
      let geometryFrame = null;
      let transitionGeometryFrame = null;
      let transitionGeometryUntil = 0;
      let resizeObserver = null;
      const listenerCleanups = [];
      const geometry = {
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        valid: false,
      };

      const listen = (target, type, handler, options) => {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler, options);
        listenerCleanups.push(() => target.removeEventListener(type, handler, options));
      };

      const refreshGeometry = () => {
        if (disposed) return false;
        try {
          if (
            frame !== byModal.frame ||
            frame.contentDocument !== frameDocument
          ) {
            geometry.valid = false;
            framePointer = null;
            return false;
          }
          const rect = frame.getBoundingClientRect();
          const viewportWidth = Math.max(1, frameWindow.innerWidth);
          const viewportHeight = Math.max(1, frameWindow.innerHeight);
          const scaleX = rect.width / viewportWidth;
          const scaleY = rect.height / viewportHeight;
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            !Number.isFinite(rect.left) ||
            !Number.isFinite(rect.top) ||
            !Number.isFinite(scaleX) ||
            !Number.isFinite(scaleY)
          ) {
            geometry.valid = false;
            framePointer = null;
            return false;
          }
          geometry.left = rect.left;
          geometry.top = rect.top;
          geometry.scaleX = scaleX;
          geometry.scaleY = scaleY;
          geometry.valid = true;
          // The iframe moved under a stationary system pointer. Its previous
          // local coordinate no longer identifies the real viewport point.
          framePointer = null;
          return true;
        } catch {
          geometry.valid = false;
          framePointer = null;
          return false;
        }
      };

      const scheduleGeometryRefresh = () => {
        if (
          disposed ||
          geometryFrame !== null ||
          transitionGeometryFrame !== null
        ) {
          return;
        }
        geometryFrame = requestAnimationFrame(() => {
          geometryFrame = null;
          refreshGeometry();
        });
      };

      // A transformed modal changes the iframe's visual rect without
      // triggering ResizeObserver. Follow only the short compositor flight,
      // then park again; pointer events themselves never read layout.
      const followTransitionGeometry = (now) => {
        transitionGeometryFrame = null;
        if (disposed) return;
        refreshGeometry();
        if (now < transitionGeometryUntil) {
          transitionGeometryFrame = requestAnimationFrame(followTransitionGeometry);
        }
      };
      const startTransitionGeometry = () => {
        if (disposed) return;
        transitionGeometryUntil = performance.now() + fastMs() + 80;
        if (geometryFrame !== null) {
          cancelAnimationFrame(geometryFrame);
          geometryFrame = null;
        }
        if (transitionGeometryFrame === null) {
          transitionGeometryFrame = requestAnimationFrame(followTransitionGeometry);
        }
      };
      const finishTransitionGeometry = () => {
        transitionGeometryUntil = 0;
        if (transitionGeometryFrame !== null) {
          cancelAnimationFrame(transitionGeometryFrame);
          transitionGeometryFrame = null;
        }
        scheduleGeometryRefresh();
      };

      let bridge = null;
      bridge = {
        frame,
        frameDocument,
        refreshGeometry,
        scheduleGeometryRefresh,
        dispose() {
          if (disposed) return;
          disposed = true;
          Social.cancelCursorChatPending?.(chatPendingOwner);
          geometry.valid = false;
          framePointer = null;
          if (geometryFrame !== null) cancelAnimationFrame(geometryFrame);
          if (transitionGeometryFrame !== null) {
            cancelAnimationFrame(transitionGeometryFrame);
          }
          geometryFrame = null;
          transitionGeometryFrame = null;
          resizeObserver?.disconnect();
          resizeObserver = null;
          for (const cleanup of listenerCleanups.splice(0)) {
            try {
              cleanup();
            } catch {
              /* a navigated WindowProxy may already reject parent access */
            }
          }
        },
      };
      playgroundFrameBridge = bridge;

      const parentPoint = (e) => {
        if (!geometry.valid) return null;
        framePointer ||= { x: 0, y: 0 };
        framePointer.x = geometry.left + e.clientX * geometry.scaleX;
        framePointer.y = geometry.top + e.clientY * geometry.scaleY;
        return framePointer;
      };
      const isEditableEvent = (event) => {
        const path =
          typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        return path.some(
          (node) =>
            node?.nodeType === 1 &&
            (node.tagName === 'INPUT' ||
              node.tagName === 'TEXTAREA' ||
              node.tagName === 'SELECT' ||
              node.isContentEditable)
        );
      };
      const isFinePointerEvent = (event) =>
        !event.pointerType ||
        event.pointerType === 'mouse' ||
        event.pointerType === 'pen';

      const handlePointerMove = (e) => {
        if (!isFinePointerEvent(e)) return;
        const point = parentPoint(e);
        if (!point) return;
        Social.trackPointer?.(point.x, point.y);
        presence?.pointerMove?.(point.x, point.y);
      };
      const handlePointerArrival = (e) => {
        if (!framePointer) handlePointerMove(e);
      };
      const handlePointerExit = (e) => {
        if (!isFinePointerEvent(e) || e.relatedTarget !== null) return;
        framePointer = null;
      };
      const handleFrameBlur = () => {
        framePointer = null;
      };
      const handlePointerDown = (e) => {
        const point = isFinePointerEvent(e) ? parentPoint(e) : null;
        if (point) {
          Social.trackPointer?.(point.x, point.y, false);
          presence?.pointerMove?.(point.x, point.y);
        }
        if (Social.isCursorChatOpen?.()) Social.closeCursorChat?.();
      };
      const handlePageHide = () => {
        if (
          epoch === playgroundEpoch &&
          frame === byModal.frame &&
          openItem === item
        ) {
          frame.classList.remove('is-ready');
          byModal.body.classList.remove('is-live');
        }
        if (playgroundFrameBridge === bridge) {
          disposePlaygroundFrameBridge(frame);
        } else {
          bridge.dispose();
        }
      };
      const handleKeyDown = (e) => {
        if (
          e.key === '/' &&
          !e.defaultPrevented &&
          !e.repeat &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.isComposing &&
          e.keyCode !== 229 &&
          !isEditableEvent(e)
        ) {
          e.preventDefault();
          e.stopPropagation();
          Social.openCursorChat?.(
            framePointer
              ? {
                  x: framePointer.x,
                  y: framePointer.y,
                  pendingOwner: chatPendingOwner,
                }
              : {
                  requireFreshPointer: true,
                  pendingOwner: chatPendingOwner,
                }
          );
          return;
        }
        if (
          e.key !== 'Escape' ||
          e.defaultPrevented ||
          e.isComposing ||
          e.keyCode === 229
        ) {
          return;
        }
        if (Social.isCursorChatOpen?.()) {
          e.preventDefault();
          e.stopPropagation();
          Social.closeCursorChat?.();
          return;
        }
        closePlayground();
      };
      const handleModalTransitionRun = (event) => {
        if (
          event.target === byModal.window &&
          event.propertyName === 'transform'
        ) {
          startTransitionGeometry();
        }
      };
      const handleModalTransitionDone = (event) => {
        if (
          event.target === byModal.window &&
          event.propertyName === 'transform'
        ) {
          finishTransitionGeometry();
        }
      };

      listen(
        frameWindow,
        'pointerover',
        handlePointerArrival,
        { passive: true }
      );
      listen(
        frameWindow,
        'pointerenter',
        handlePointerArrival,
        { passive: true }
      );
      listen(
        frameWindow,
        'pointermove',
        handlePointerMove,
        { passive: true }
      );
      listen(
        frameWindow,
        'pointerout',
        handlePointerExit,
        { passive: true }
      );
      listen(
        frameWindow,
        'pointerdown',
        handlePointerDown,
        { capture: true, passive: true }
      );
      listen(frameWindow, 'pagehide', handlePageHide);
      listen(frameWindow, 'blur', handleFrameBlur);
      listen(frameWindow, 'keydown', handleKeyDown);
      listen(frameWindow, 'resize', scheduleGeometryRefresh, { passive: true });
      listen(frameWindow, 'scroll', scheduleGeometryRefresh, { passive: true });
      listen(window, 'resize', scheduleGeometryRefresh, { passive: true });
      listen(window, 'scroll', scheduleGeometryRefresh, {
        capture: true,
        passive: true,
      });
      listen(window.visualViewport, 'resize', scheduleGeometryRefresh, {
        passive: true,
      });
      listen(window.visualViewport, 'scroll', scheduleGeometryRefresh, {
        passive: true,
      });
      listen(byModal.window, 'transitionrun', handleModalTransitionRun);
      listen(byModal.window, 'transitionend', handleModalTransitionDone);
      listen(byModal.window, 'transitioncancel', handleModalTransitionDone);

      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(scheduleGeometryRefresh);
        resizeObserver.observe(frame);
      }

      refreshGeometry();
      if (getComputedStyle(byModal.window).transform !== 'none') {
        startTransitionGeometry();
      }
      Social.syncCustomCursor?.(frame);
    } catch {
      disposePlaygroundFrameBridge(frame);
      /* a replaced frame can disappear between load and listener setup */
    }
    // Keep the iframe untargetable until its own document has hidden the
    // native cursor; otherwise the first expansion frame flashes a system
    // arrow before the custom cursor bridge takes over.
    frame.classList.add('is-ready');
    byModal.body.classList.add('is-live'); // placeholder thumb yields to the live view
  }

  function replacePlaygroundFrame(item = null, epoch = playgroundEpoch) {
    const frame = document.createElement('iframe');
    frame.className = 'playground-frame';
    frame.id = 'pg-frame';
    frame.title = 'Component playground';

    if (item) {
      const expected = playgroundUrl(item);
      let targetStarted = false;
      frame.addEventListener('load', () => {
        if (epoch !== playgroundEpoch || frame !== byModal.frame || openItem !== item) return;
        if (!targetStarted) {
          targetStarted = true;
          if (expected !== 'about:blank') frame.src = expected;
          return;
        }
        markPlaygroundFrameReady(frame, item, expected, epoch);
      });
    }

    const previous = byModal.frame;
    disposePlaygroundFrameBridge(previous);
    byModal.frame = frame;
    Social.releaseCustomCursorFrame?.(previous);
    previous.replaceWith(frame);
    return frame;
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

  function cancelFlightTimers() {
    clearTimeout(morphTimer);
    clearTimeout(closeTimer);
    morphTimer = null;
    closeTimer = null;
  }

  function setFlightState(state) {
    const win = byModal.window;
    win.classList.toggle('is-morphing', state === 'opening');
    win.classList.toggle('is-returning', state === 'returning');
  }

  function clearFlightArtifacts() {
    setFlightState(null);
    for (const property of ['transform', 'transform-origin', 'transition', 'opacity']) {
      byModal.window.style.removeProperty(property);
    }
    // Defensive cleanup for a close interrupted while running older code.
    byModal.frame.style.removeProperty('opacity');
    byModal.frame.style.removeProperty('transition');
    playgroundFrameBridge?.scheduleGeometryRefresh();
  }

  function resetPlaygroundVideo() {
    const video = byModal.video;
    video.pause();
    video.hidden = true;
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
    byModal.body.classList.remove('is-video', 'is-live');
  }

  function fallbackPlaygroundVideo() {
    if (!byModal.video.hasAttribute('src')) return;
    byModal.body.classList.remove('is-live');
    resetPlaygroundVideo();
  }

  function preparePlaygroundVideo(item) {
    resetPlaygroundVideo();
    if (item.type !== 'video' || !item.video || !canPlayVideo()) return;
    byModal.video.src = item.video;
    if (item.poster) byModal.video.poster = item.poster;
    byModal.video.hidden = false;
    byModal.body.classList.add('is-video');
  }

  function playPlaygroundVideo(item, epoch = playgroundEpoch) {
    if (
      item.type !== 'video' ||
      !item.video ||
      !canPlayVideo() ||
      epoch !== playgroundEpoch ||
      openItem !== item
    ) {
      return;
    }
    const video = byModal.video;
    video.play()
      .then(() => {
        if (epoch !== playgroundEpoch || openItem !== item) {
          video.pause();
          return;
        }
        byModal.body.classList.add('is-live');
      })
      .catch(() => {
        if (epoch === playgroundEpoch && openItem === item) fallbackPlaygroundVideo();
      });
  }

  function pausePlaygroundVideo(showPoster = false) {
    byModal.video.pause();
    if (showPoster) byModal.body.classList.remove('is-live');
  }

  byModal.video.addEventListener('error', fallbackPlaygroundVideo);
  const enforceVideoPreferences = () => {
    if (!canPlayVideo()) fallbackPlaygroundVideo();
  };
  reduceMotion.addEventListener('change', enforceVideoPreferences);
  hoverPlayback.addEventListener('change', enforceVideoPreferences);
  connection?.addEventListener?.('change', enforceVideoPreferences);

  function finishPlaygroundOpen(item, epoch) {
    morphTimer = null;
    if (epoch !== playgroundEpoch || openItem !== item) return;
    clearFlightArtifacts();
    if (item.demo) replacePlaygroundFrame(item, epoch);
    playPlaygroundVideo(item, epoch);
    // inert invalidates style for the whole shell subtree (8 iframe
    // documents) — never spend that on a flight-critical frame.
    shell.inert = true;
    byModal.close.focus({ preventScroll: true });
  }

  function openPlayground(item) {
    if (openItem?.slug === item.slug) return;
    const win = byModal.window;
    const wasClosing =
      byModal.root.classList.contains('is-closing') &&
      win.classList.contains('is-returning') &&
      !reduceMotion.matches;
    const wasOpening =
      !wasClosing && win.classList.contains('is-morphing') && !reduceMotion.matches;
    // Freeze an interrupted return at its current visual matrix, then retarget
    // that same surface to its open resting position without a geometry jump.
    const interruptedTransform = wasClosing ? getComputedStyle(win).transform : null;
    const interruptedOpacity = wasClosing ? getComputedStyle(win).opacity : null;
    const epoch = ++playgroundEpoch;
    cancelFlightTimers();
    // Capture the return target only on a fresh open — switching items while
    // the modal is up must not overwrite it with the close button.
    const isSwitch = Boolean(openItem);
    lastFocus ??= document.activeElement;
    openItem = item;

    byModal.title.textContent = item.title;
    byModal.github.href = item.github;
    byModal.body.style.background = item.bg;
    byModal.frame.classList.remove('is-ready');
    byModal.body.classList.remove('is-live');
    byModal.body.classList.toggle('is-static', Boolean(item.image));
    byModal.body.classList.toggle('has-thumb', Boolean(item.thumb));
    preparePlaygroundVideo(item);

    // Static explorations keep this image for the whole visit. A demo may use
    // the same layer as a landing placeholder before its iframe is ready.
    if (item.thumb) {
      byModal.thumb.src = item.thumb;
      byModal.thumb.alt = item.image ? `${item.title} preview` : '';
      byModal.thumb.hidden = false;
    } else {
      byModal.thumb.hidden = true;
      byModal.thumb.removeAttribute('src');
      byModal.thumb.alt = '';
    }

    // Drop a previously running demo when switching to a static exploration.
    if (item.image) replacePlaygroundFrame();

    byModal.root.hidden = false;

    if (wasClosing) {
      win.style.transition = 'none';
      win.style.transformOrigin = '0 0';
      win.style.transform = interruptedTransform === 'none' ? '' : interruptedTransform;
      win.style.opacity = interruptedOpacity;
      byModal.frame.style.removeProperty('opacity');
      byModal.frame.style.removeProperty('transition');
      byModal.root.classList.remove('is-closing');
      byModal.root.classList.add('is-open');
      setFlightState('opening');
      void win.offsetWidth;
      win.style.removeProperty('transition');
      win.style.removeProperty('transform');
      win.style.removeProperty('opacity');
      morphTimer = setTimeout(
        () => finishPlaygroundOpen(item, epoch),
        fastMs() + 30,
      );
    } else if (wasOpening && isSwitch) {
      // The window is already travelling home from another card. Keep that
      // continuous transform, but let the new navigation own the landing.
      byModal.root.classList.remove('is-closing');
      byModal.root.classList.add('is-open');
      setFlightState('opening');
      morphTimer = setTimeout(
        () => finishPlaygroundOpen(item, epoch),
        fastMs() + 30,
      );
    } else {
      byModal.root.classList.remove('is-closing');
      clearFlightArtifacts();
    }

    const source = !isSwitch && !reduceMotion.matches && cardMediaFor(item.slug);
    if (!wasClosing && !(wasOpening && isSwitch) && source) {
      // FLIP: jump straight to the open state, then start the window at the
      // card's rect and let one transform transition carry it home. The demo
      // iframe loads only after landing — it is masked during the flight
      // anyway, and parsing it mid-flight costs main-thread frames.
      byModal.root.classList.add('is-open');
      setFlightState('opening');
      const first = source.getBoundingClientRect();
      const last = layoutRect(win);
      win.style.transformOrigin = '0 0';
      win.style.transition = 'none';
      win.style.transform = flipTransform(first, last);
      // The card owns the first visual beat; the fixed 12px modal surface
      // fades in only as it nears its resting geometry. This avoids both the
      // non-uniform-radius snap and a paint-heavy border-radius animation.
      win.style.opacity = '0';
      void win.offsetWidth;
      win.style.removeProperty('transition');
      win.style.removeProperty('transform');
      win.style.removeProperty('opacity');
      morphTimer = setTimeout(
        () => finishPlaygroundOpen(item, epoch),
        fastMs() + 30,
      );
    } else if (!wasClosing && !(wasOpening && isSwitch)) {
      if (item.demo) replacePlaygroundFrame(item, epoch);
      void byModal.root.offsetWidth; // commit hidden -> visible before transitioning
      byModal.root.classList.add('is-open');
      // aria-modal only claims the background is out of reach; inert makes it so.
      shell.inert = true;
      byModal.close.focus({ preventScroll: true });
      playPlaygroundVideo(item, epoch);
    }

    if (location.hash.slice(1) !== item.slug) {
      history.replaceState(null, '', `#${item.slug}`);
    }
    presence?.focus(item.slug);
  }

  function closePlayground() {
    if (!openItem) return;
    const item = openItem;
    playgroundEpoch += 1;
    const source = !reduceMotion.matches && cardMediaFor(item.slug);
    openItem = null;
    resetPlaygroundVideo();
    clearTimeout(morphTimer);
    morphTimer = null;

    const win = byModal.window;
    if (source) {
      // Reverse flight: the modal starts moving home, then fades early enough
      // for the original card to own the final geometry and its 10px corners.
      const first = layoutRect(win);
      const target = source.getBoundingClientRect();
      const currentTransform = getComputedStyle(win).transform;
      const currentOpacity = getComputedStyle(win).opacity;
      const returnTransform = flipTransform(target, first);
      win.style.transition = 'none';
      win.style.transform = currentTransform === 'none' ? 'none' : currentTransform;
      win.style.transformOrigin = '0 0';
      win.style.opacity = currentOpacity;
      setFlightState('returning');
      if (item.thumb) {
        byModal.thumb.hidden = false;
      }
      byModal.body.classList.toggle('has-thumb', Boolean(item.thumb));
      byModal.root.classList.add('is-closing');
      byModal.root.classList.remove('is-open');
      void win.offsetWidth;
      win.style.removeProperty('transition');
      win.style.transform = returnTransform;
      win.style.removeProperty('opacity');
    } else {
      clearFlightArtifacts();
      byModal.root.classList.add('is-closing');
      byModal.root.classList.remove('is-open');
    }
    // The return flight runs the full --duration-fast; hide right at landing,
    // where the window exactly overlays the near-identical card.
    closeTimer = setTimeout(() => {
      closeTimer = null;
      byModal.root.hidden = true;
      byModal.root.classList.remove('is-open', 'is-closing');
      replacePlaygroundFrame();
      byModal.thumb.hidden = true;
      byModal.thumb.removeAttribute('src');
      byModal.thumb.alt = '';
      resetPlaygroundVideo();
      byModal.body.classList.remove('has-thumb', 'is-live', 'is-static', 'is-video');
      clearFlightArtifacts();
      // Un-inert after landing (same shell-wide style invalidation as open),
      // and only then hand focus back — focus() on an inert subtree is a no-op.
      shell.inert = false;
      lastFocus?.focus({ preventScroll: true });
      lastFocus = null;
    }, reduceMotion.matches ? 0 : fastMs() + 40);

    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    presence?.focus(null);
  }

  byModal.close.addEventListener('click', closePlayground);
  byModal.backdrop.addEventListener('click', closePlayground);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && openItem) closePlayground();
  });
  document.addEventListener('visibilitychange', () => {
    if (openItem?.type !== 'video') return;
    if (document.hidden) pausePlaygroundVideo();
    else playPlaygroundVideo(openItem);
  });
  reduceMotion.addEventListener('change', (event) => {
    if (openItem?.type !== 'video') return;
    if (!event.matches && canPlayVideo()) {
      preparePlaygroundVideo(openItem);
      playPlaygroundVideo(openItem);
    }
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

  presence = Presence.start({
    loc: Social.location,
    onSelf: (self) => Social.onSelf(self),
    onLocations: (list) => Social.onLocations(list),
    onBullet: (b) => Social.onBullet(b),
    onLikes: renderLikeSnapshot,
    onLike: renderLikeChange,
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
