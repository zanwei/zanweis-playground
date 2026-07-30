/**
 * Social layer: the online-count globe and Figma-style cursor chat.
 *
 * Shared location is inferred from the timezone and remains continent-level.
 * Opening the globe may use browser geolocation to refine only the viewer's
 * own marker; precise coordinates never enter the presence channel.
 *
 * The globe is cobe (github.com/shuding/cobe, vendored). The viewer keeps
 * their presence color; remote visitors share one blue marker per continent.
 * Cobe's anchor divs keep every label attached to the spinning globe.
 */
'use strict';

const Social = (() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(any-pointer: fine)');
  const bootInProgress = () => {
    const root = document.documentElement;
    return (
      root.classList.contains('booting') ||
      root.classList.contains('revealing')
    );
  };

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

  const CONTINENTS = {
    AF: { lat: 5, lng: 20 },
    AN: { lat: -78, lng: 0 },
    AS: { lat: 34, lng: 95 },
    EU: { lat: 51, lng: 15 },
    NA: { lat: 43, lng: -102 },
    OC: { lat: -25, lng: 135 },
    SA: { lat: -15, lng: -60 },
    XX: { lat: 0, lng: -20 },
  };
  const CONTINENT_NAMES = {
    AF: 'Africa',
    AN: 'Antarctica',
    AS: 'Asia',
    EU: 'Europe',
    NA: 'North America',
    OC: 'Oceania',
    SA: 'South America',
    XX: 'Unknown',
  };
  const CONTINENT_ORDER = ['NA', 'SA', 'EU', 'AF', 'AS', 'OC', 'AN', 'XX'];
  const SOUTH_AMERICA_TZ =
    /^(?:America\/(?:Argentina\/.+|Araguaina|Asuncion|Bahia|Belem|Boa_Vista|Bogota|Buenos_Aires|Campo_Grande|Caracas|Catamarca|Cayenne|Cordoba|Coyhaique|Cuiaba|Eirunepe|Fortaleza|Guayaquil|Guyana|Jujuy|La_Paz|Lima|Maceio|Manaus|Mendoza|Montevideo|Noronha|Paramaribo|Porto_Velho|Punta_Arenas|Recife|Rio_Branco|Rosario|Santarem|Santiago|Sao_Paulo)|Atlantic\/(?:South_Georgia|Stanley)|Pacific\/(?:Easter|Galapagos))$/;
  const TIMEZONE_CONTINENT_EXCEPTIONS = {
    'Atlantic/Azores': 'EU',
    'Atlantic/Canary': 'EU',
    'Atlantic/Faeroe': 'EU',
    'Atlantic/Faroe': 'EU',
    'Atlantic/Jan_Mayen': 'EU',
    'Atlantic/Madeira': 'EU',
    'Atlantic/Reykjavik': 'EU',
    'Atlantic/Bermuda': 'NA',
    'Atlantic/Cape_Verde': 'AF',
    'Atlantic/St_Helena': 'AF',
    'Indian/Antananarivo': 'AF',
    'Indian/Comoro': 'AF',
    'Indian/Mahe': 'AF',
    'Indian/Mauritius': 'AF',
    'Indian/Mayotte': 'AF',
    'Indian/Reunion': 'AF',
    'Indian/Chagos': 'AS',
    'Indian/Christmas': 'AS',
    'Indian/Cocos': 'AS',
    'Indian/Maldives': 'AS',
    'Indian/Kerguelen': 'AN',
    'Pacific/Honolulu': 'NA',
  };

  function continentForTimeZone(tz) {
    if (SOUTH_AMERICA_TZ.test(tz)) return 'SA';
    if (TIMEZONE_CONTINENT_EXCEPTIONS[tz]) return TIMEZONE_CONTINENT_EXCEPTIONS[tz];
    return (
      {
        Africa: 'AF',
        America: 'NA',
        Antarctica: 'AN',
        Asia: 'AS',
        Australia: 'OC',
        Europe: 'EU',
        Pacific: 'OC',
      }[tz.split('/')[0]] || 'XX'
    );
  }

  function continentCode(loc) {
    const raw = String(loc?.continent || loc?.label || '')
      .trim()
      .toLowerCase();

    if (raw === 'af' || raw.includes('africa')) return 'AF';
    if (raw === 'an' || raw.includes('antarct')) return 'AN';
    if (raw === 'as' || raw === 'asia') return 'AS';
    if (raw === 'eu' || raw.includes('europe')) return 'EU';
    if (raw === 'na' || raw.includes('north america')) return 'NA';
    if (
      raw === 'oc' ||
      raw.includes('oceania') ||
      raw.includes('australia') ||
      raw.includes('pacific')
    ) {
      return 'OC';
    }
    if (raw === 'sa' || raw.includes('south america')) return 'SA';
    if (raw === 'xx' || raw.includes('atlantic') || raw.includes('indian ocean')) return 'XX';

    const lat = Number(loc?.lat);
    const lng = Number(loc?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'XX';
    if (lat <= -60) return 'AN';
    if (lng < -25) return lat < 13 ? 'SA' : 'NA';
    if (lng >= -25 && lng <= 55 && lat >= -38 && lat < 37) return 'AF';
    if (lng >= -25 && lng <= 45 && lat >= 37) return 'EU';
    if (lng >= 105 && lat < 0) return 'OC';
    if (lng >= 25) return 'AS';
    return 'XX';
  }

  function coarseLocation() {
    let tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      /* fall through to the ocean */
    }
    const inferredContinent = continentForTimeZone(tz);
    const center = CONTINENTS[inferredContinent];
    const hit =
      TZ[tz] ||
      (inferredContinent !== 'XX' && [
        center.lat,
        center.lng,
        CONTINENT_NAMES[inferredContinent],
      ]) ||
      REGION[tz.split('/')[0]] ||
      [20, 0, 'the Atlantic Ocean'];
    const loc = { lat: hit[0], lng: hit[1], label: hit[2] };
    return {
      ...loc,
      continent: inferredContinent === 'XX' ? continentCode(loc) : inferredContinent,
    };
  }

  const sharedLocation = coarseLocation();
  const selfLocation = { ...sharedLocation };

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
  let globeTheta = 0.1;
  let focusTheta = 0.1;
  let focusingSelf = false;
  let preciseLocationState = 'idle';

  function requestPreciseLocation() {
    if (
      preciseLocationState === 'loading' ||
      preciseLocationState === 'ready' ||
      preciseLocationState === 'denied' ||
      !window.isSecureContext ||
      !navigator.geolocation
    ) {
      return;
    }
    preciseLocationState = 'loading';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = Number(coords.latitude);
        const lng = Number(coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          preciseLocationState = 'idle';
          return;
        }
        const preciseLat = Math.max(-90, Math.min(90, lat));
        const preciseLng = ((lng + 540) % 360) - 180;
        Object.assign(selfLocation, {
          lat: preciseLat,
          lng: preciseLng,
          label: 'Your location',
          // Derive this from the new coordinates rather than retaining the
          // timezone-based value copied into selfLocation at startup.
          continent: continentCode({ lat: preciseLat, lng: preciseLng }),
        });
        preciseLocationState = 'ready';
        // This changes only the local marker. The shared coarse location
        // remains untouched so exact coordinates never leave the browser.
        focusOnSelf({ immediate: !popOpen || !globe });
        syncMarkerEntries({ animateExits: false });
      },
      (error) => {
        preciseLocationState = error?.code === 1 ? 'denied' : 'idle';
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
      }
    );
  }

  // From the cobe docs: angles that bring [lat, lng] to the front.
  const focusAngles = (lat, lng) => [
    Math.PI - ((lng * Math.PI) / 180 - Math.PI / 2),
    (lat * Math.PI) / 180,
  ];

  function focusOnSelf({ immediate = false } = {}) {
    const [nextPhi, nextTheta] = focusAngles(selfLocation.lat, selfLocation.lng);
    const turn = Math.PI * 2;
    // Choose the nearest equivalent rotation so an async geolocation result
    // never sends the globe the long way around.
    focusPhi =
      phi + ((((nextPhi - phi + Math.PI) % turn) + turn) % turn - Math.PI);
    focusTheta = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, nextTheta));
    dragOffset = 0;
    dragTarget = 0;
    focusingSelf = !immediate;
    if (immediate) {
      phi = focusPhi;
      globeTheta = focusTheta;
    }
  }

  function desiredMarkerEntries() {
    const selfHex = hexOf(selfColor) === '#111114' ? PRESENCE_HEX.orange : hexOf(selfColor);
    const selfContinent = continentCode(selfLocation);
    const entries = [
      {
        id: 'self',
        lat: selfLocation.lat,
        lng: selfLocation.lng,
        label: 'You’re here',
        size: 0.09,
        color: rgb01(selfHex),
        placement: 'above',
      },
    ];
    const groups = new Map();

    for (const peer of peerLocations) {
      if (!peer?.loc) continue;
      const code = continentCode(peer.loc);
      groups.set(code, (groups.get(code) || 0) + 1);
    }

    for (const code of CONTINENT_ORDER) {
      const count = groups.get(code);
      if (!count) continue;
      const center = CONTINENTS[code];
      entries.push({
        id: `continent-${code.toLowerCase()}`,
        lat: center.lat,
        lng: center.lng,
        label: code === 'XX' ? `Other · ${count}` : `${code} · ${count}`,
        size: Math.min(0.13, 0.07 + Math.log2(count + 1) * 0.012),
        color: rgb01(PRESENCE_HEX.blue),
        placement: code === selfContinent ? 'below' : 'above',
      });
    }

    return entries;
  }

  const CHIP_EXIT_MS = 150;
  const renderedMarkers = new Map();
  let chipRefs = new Map(); // marker id -> { chip, lat, lng }
  let chipRetry = null;

  function markerList() {
    return [...renderedMarkers.values()].map(({ id, lat, lng, size, color }) => ({
      id,
      location: [lat, lng],
      size,
      color,
    }));
  }

  function refreshGlobeMarkers() {
    if (!globe) return;
    globe.update({ markers: markerList() });
    attachChipsSoon();
  }

  function finishMarkerExit(id, entry) {
    if (renderedMarkers.get(id) !== entry || !entry.exiting) return;
    renderedMarkers.delete(id);
    chipRefs.delete(id);
    refreshGlobeMarkers();
  }

  function syncMarkerEntries({ animateExits = popOpen && !reduceMotion.matches } = {}) {
    const desired = new Map(desiredMarkerEntries().map((entry) => [entry.id, entry]));

    for (const [id, next] of desired) {
      const current = renderedMarkers.get(id);
      if (current) {
        clearTimeout(current.exitTimer);
        Object.assign(current, next, { exiting: false, exitTimer: null });
        chipRefs.get(id)?.chip.classList.remove('is-exiting');
      } else {
        renderedMarkers.set(id, { ...next, exiting: false, exitTimer: null });
      }
    }

    for (const [id, current] of renderedMarkers) {
      if (desired.has(id) || current.exiting) continue;
      if (!animateExits) {
        clearTimeout(current.exitTimer);
        renderedMarkers.delete(id);
        chipRefs.delete(id);
        continue;
      }
      current.exiting = true;
      chipRefs.get(id)?.chip.classList.add('is-exiting');
      current.exitTimer = setTimeout(
        () => finishMarkerExit(id, current),
        CHIP_EXIT_MS + 20
      );
    }

    refreshGlobeMarkers();
  }

  function chipsAreAttached() {
    return (
      chipRefs.size === renderedMarkers.size &&
      [...chipRefs.values()].every(({ chip }) => chip.isConnected)
    );
  }

  // Cobe creates its anchor divs on its own schedule; retry until every
  // stable marker id has a matching anchor.
  function attachChipsSoon() {
    clearInterval(chipRetry);
    attachChips();
    if (chipsAreAttached()) return;
    let tries = 0;
    chipRetry = setInterval(() => {
      attachChips();
      if (chipsAreAttached() || ++tries > 16 || !popOpen) {
        clearInterval(chipRetry);
      }
    }, 120);
  }

  function attachChips() {
    const anchors = new Map();
    for (const candidate of wrap.querySelectorAll('div')) {
      const name = candidate.style.getPropertyValue('anchor-name');
      if (name.startsWith('--cobe-')) anchors.set(name.slice('--cobe-'.length), candidate);
    }

    const nextRefs = new Map();
    for (const entry of renderedMarkers.values()) {
      const anchor = anchors.get(entry.id);
      if (!anchor) continue;
      let record = chipRefs.get(entry.id);
      if (!record) {
        const chip = document.createElement('span');
        chip.className = 'globe-chip';
        chip.dataset.marker = entry.id;
        record = { chip, lat: entry.lat, lng: entry.lng };
      }
      record.lat = entry.lat;
      record.lng = entry.lng;
      record.chip.textContent = entry.label;
      record.chip.dataset.placement = entry.placement;
      record.chip.classList.toggle('is-exiting', entry.exiting);
      if (record.chip.parentElement !== anchor) anchor.appendChild(record.chip);
      nextRefs.set(entry.id, record);
    }
    chipRefs = nextRefs;
    updateChipVisibility(); // correct visibility before the first spin frame
  }

  function markerFront(lat, lng) {
    const latRad = (lat * Math.PI) / 180;
    const lngRad = (lng * Math.PI) / 180 - Math.PI;
    const cosLat = Math.cos(latRad);
    const x = -cosLat * Math.cos(lngRad);
    const y = Math.sin(latRad);
    const z = cosLat * Math.sin(lngRad);
    const shown = phi + dragOffset;
    return (
      -Math.sin(shown) * Math.cos(globeTheta) * x +
      Math.sin(globeTheta) * y +
      Math.cos(shown) * Math.cos(globeTheta) * z
    );
  }

  function updateChipVisibility() {
    // Class changes, rather than discrete visibility writes, give chips a
    // soft blur/fade as their marker rotates behind the globe.
    for (const [id, { chip, lat, lng }] of chipRefs) {
      const entry = renderedMarkers.get(id);
      if (!entry || entry.exiting) {
        chip.classList.remove('is-visible');
        continue;
      }
      chip.classList.toggle('is-visible', markerFront(lat, lng) > 0.12);
    }
  }

  function openPop() {
    if (popOpen) return;
    popOpen = true;
    clearTimeout(closeTimer);
    pop.hidden = false;
    void pop.offsetWidth;
    pop.classList.remove('is-closing');
    pop.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');

    // Reopening during the close transition revives the existing WebGL
    // instance instead of orphaning it behind a newly-created canvas.
    if (globe) {
      syncMarkerEntries({ animateExits: false });
      spin();
      return;
    }

    const size = 280 * Math.min(2, devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.style.width = '280px';
    canvas.style.height = '280px';
    wrap.replaceChildren(canvas);
    bindDrag(canvas);

    focusOnSelf({ immediate: true });
    syncMarkerEntries({ animateExits: false });

    globe = window.createGlobe(canvas, {
      devicePixelRatio: Math.min(2, devicePixelRatio || 1),
      width: size,
      height: size,
      phi,
      theta: globeTheta,
      dark: 0,
      diffuse: 1.2,
      mapSamples: 14000,
      mapBrightness: 5,
      baseColor: [0.92, 0.92, 0.93],
      markerColor: [0.96, 0.34, 0.05],
      glowColor: [1, 1, 1],
      scale: 1.22,
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
      if (focusingSelf) {
        const focusK = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / 180);
        phi += (focusPhi - phi) * focusK;
        globeTheta += (focusTheta - globeTheta) * focusK;
        if (
          Math.abs(focusPhi - phi) < 0.001 &&
          Math.abs(focusTheta - globeTheta) < 0.001
        ) {
          phi = focusPhi;
          globeTheta = focusTheta;
          focusingSelf = false;
        }
      } else if (!reduceMotion.matches && dragging === null) {
        phi += 0.00017 * dt;
      }
      // Damped approach: interruptible, carries a little momentum.
      const k = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / 90);
      dragOffset += (dragTarget - dragOffset) * k;
      globe.update({ phi: phi + dragOffset, theta: globeTheta });
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
      clearInterval(chipRetry);
      for (const entry of renderedMarkers.values()) clearTimeout(entry.exitTimer);
      renderedMarkers.clear();
      chipRefs.clear();
      globe?.destroy(); // the globe never burns frames while closed
      globe = null;
      wrap.replaceChildren();
      dragging = null;
      dragOffset = 0;
      dragTarget = 0;
      focusingSelf = false;
    }, reduceMotion.matches ? 0 : 180);
  }

  if (btn && pop) {
    btn.addEventListener('click', () => {
      if (!popOpen) requestPreciseLocation();
      if (popOpen) closePop();
      else openPop();
    });
    // Reuse an existing grant without showing a prompt during page load.
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then(({ state }) => {
          if (state === 'granted') requestPreciseLocation();
        })
        .catch(() => {
          /* Permissions API support is optional; the click path still works. */
        });
    }
    document.addEventListener('pointerdown', (e) => {
      if (popOpen && !pop.contains(e.target) && !btn.contains(e.target)) closePop();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popOpen) closePop();
    });
  }

  // --- bullet screen (press / to talk) -------------------------------------
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

  // Start with the display enabled for new visitors, while preserving an
  // explicit choice made with the toggle on an earlier visit.
  let bulletsOn = true;
  try {
    const storedBulletMode = localStorage.getItem('zw-bullets');
    if (storedBulletMode !== null) bulletsOn = storedBulletMode === '1';
  } catch {
    /* private mode: keep the default on */
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
    // Bullet chat is transient live state. A message received behind the
    // loader should not materialize halfway across the screen after reveal.
    if (bootInProgress() || !bulletsOn || !text) return;
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
    let restoreComposerFocus = false;
    close.addEventListener('pointerdown', () => {
      // The dock is now permanently visible, so visibility no longer means
      // the visitor was composing a bullet. Restore focus only when this
      // dismiss action actually interrupted the bullet input.
      restoreComposerFocus = document.activeElement === barInput;
    });
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
        if (restoreComposerFocus) focusComposerInput();
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
      if (restoreComposerFocus) focusComposerInput();
    });
  }

  // Bottom input bar.
  let barEl = null;
  let barInput = null;
  let barSend = null;
  let bulletModeButton = null;
  let barOpen = false;
  const compactComposer = matchMedia('(max-width: 720px)');
  const COMPOSER_LAYOUT_MS = 220;
  let composerIsCompact = compactComposer.matches;
  let composerLayout = null;
  const composerAnimations = new WeakMap();
  const composerFallbackTimers = new WeakMap();
  let composerViewportFrame = 0;
  let composerViewportTimers = [];
  const chatHint = document.getElementById('chat-hint');

  function measureComposerLayout() {
    if (!barEl || barEl.hidden) return null;
    const layout = new Map();
    for (const el of barEl.querySelectorAll('.chat-bar, .bullet-mode')) {
      const rect = el.getBoundingClientRect();
      layout.set(el, { left: rect.left, top: rect.top });
    }
    return layout;
  }

  function animateComposerLayout(previous, next) {
    if (!previous || !next || reduceMotion.matches || !barOpen) return;
    for (const [el, from] of previous) {
      const to = next.get(el);
      if (!to) continue;
      const x = from.left - to.left;
      const y = from.top - to.top;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
      composerAnimations.get(el)?.cancel();
      clearTimeout(composerFallbackTimers.get(el));

      if (typeof el.animate !== 'function') {
        el.style.transition = 'none';
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        void el.offsetWidth;
        el.style.transition = `transform ${COMPOSER_LAYOUT_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`;
        requestAnimationFrame(() => {
          el.style.transform = 'translate3d(0, 0, 0)';
          composerFallbackTimers.set(
            el,
            setTimeout(() => {
              el.style.removeProperty('transition');
              el.style.removeProperty('transform');
            }, COMPOSER_LAYOUT_MS)
          );
        });
        continue;
      }

      const animation = el.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: COMPOSER_LAYOUT_MS,
          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
          fill: 'both',
        }
      );
      composerAnimations.set(el, animation);
      animation.finished
        .catch(() => {})
        .then(() => {
          if (composerAnimations.get(el) !== animation) return;
          animation.cancel();
          composerAnimations.delete(el);
        });
    }
  }

  function resetComposerViewportPosition() {
    if (!barEl) return;
    barEl.classList.remove('is-visual-viewport');
    barEl.style.removeProperty('--composer-viewport-bottom');
  }

  function applyComposerViewportPosition() {
    composerViewportFrame = 0;
    if (!barEl) return;
    const viewport = window.visualViewport;
    if (!compactComposer.matches || !viewport) {
      resetComposerViewportPosition();
      return;
    }

    // Anchor to the visual viewport's bottom edge instead of compensating a
    // layout-viewport `bottom`. pageTop is a useful fallback while WebKit is
    // briefly reporting a stale offsetTop during keyboard animation.
    const pageOffsetTop = Number.isFinite(viewport.pageTop)
      ? viewport.pageTop - window.scrollY
      : 0;
    const visualTop = Math.max(0, viewport.offsetTop, pageOffsetTop);
    const visualBottom = visualTop + viewport.height;
    barEl.style.setProperty('--composer-viewport-bottom', `${Math.round(visualBottom)}px`);
    barEl.classList.add('is-visual-viewport');
  }

  function clearComposerViewportTimers() {
    cancelAnimationFrame(composerViewportFrame);
    composerViewportFrame = 0;
    for (const timer of composerViewportTimers) clearTimeout(timer);
    composerViewportTimers = [];
  }

  function scheduleComposerViewportSync(settle = false) {
    if (!barEl || barEl.hidden) return;
    if (settle) clearComposerViewportTimers();
    else cancelAnimationFrame(composerViewportFrame);
    composerViewportFrame = requestAnimationFrame(applyComposerViewportPosition);
    if (!settle) return;

    // WebKit may publish its final offset after the last viewport event.
    // Re-read across the keyboard animation instead of trusting one frame.
    composerViewportTimers = [50, 150, 300].map((delay) =>
      setTimeout(() => scheduleComposerViewportSync(), delay)
    );
  }

  function focusComposerInput() {
    if (!barInput) return;
    if (compactComposer.matches) barInput.focus();
    else barInput.focus({ preventScroll: true });
    scheduleComposerViewportSync(true);
  }

  addEventListener(
    'resize',
    () => {
      const nextCompact = compactComposer.matches;
      const previous = composerLayout;
      scheduleComposerViewportSync(true);
      if (nextCompact === composerIsCompact || !barOpen) {
        composerIsCompact = nextCompact;
        composerLayout = measureComposerLayout();
        return;
      }
      composerIsCompact = nextCompact;
      requestAnimationFrame(() => {
        const next = measureComposerLayout();
        animateComposerLayout(previous, next);
        composerLayout = next;
      });
    },
    { passive: true }
  );

  function ensureBar() {
    if (barEl) return;
    barEl = document.createElement('div');
    barEl.id = 'chat-dock';
    barEl.className = 'chat-dock';
    // It is mounted early so its listeners and viewport observers are ready,
    // but remains out of the render tree until the boot drawer has landed.
    barEl.hidden = true;
    barEl.innerHTML =
      `<div class="chat-bar">
        <input type="text" maxlength="120" placeholder="Send bullet chat" aria-label="Bullet screen message" />
        <button class="chat-send" aria-label="Send" disabled>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V6M6 12l6-6 6 6" stroke="currentColor" stroke-width="2.2" fill="none"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <button class="bullet-mode" id="bullet-toggle" type="button" aria-label="Bullet screen"
        aria-pressed="false" title="Show Bullet screen">
        <span class="bullet-mode-label">Bullet screen</span>
        <span class="bullet-flow" aria-hidden="true">
          <span class="bullet-flow-path" data-bullet-path></span>
          <span class="bullet-flow-path" data-bullet-path></span>
          <span class="bullet-flow-path" data-bullet-path></span>
          <span class="bullet-flow-path" data-bullet-path></span>
          <span class="bullet-flow-path" data-bullet-path></span>
        </span>
      </button>`;
    barInput = barEl.querySelector('input');
    barSend = barEl.querySelector('.chat-send');
    document.body.appendChild(barEl);
    cursorChatResizeObserver?.observe(barEl);
    wireBulletButton(barEl.querySelector('#bullet-toggle'));
    window.visualViewport?.addEventListener('resize', () => scheduleComposerViewportSync(true), {
      passive: true,
    });
    window.visualViewport?.addEventListener('scroll', () => scheduleComposerViewportSync(true), {
      passive: true,
    });
    window.visualViewport?.addEventListener('scrollend', () => scheduleComposerViewportSync(), {
      passive: true,
    });

    let composing = false;
    const syncSendState = () => {
      barSend.disabled = composing || barInput.value.trim() === '';
    };

    const doSend = () => {
      // A click or synthetic invocation during IME composition must not send
      // the unconfirmed candidate text.
      if (composing) return;
      const text = barInput.value.trim();
      if (!text) return;
      // Sending is an explicit request to see the message. Turn the display
      // back on before broadcasting so the same action also renders the
      // sender's bullet instead of requiring a second click.
      if (!bulletsOn) setBulletMode(true);
      presence?.say(text);
      spawnBullet(text, true);
      barInput.value = '';
      syncSendState();
      focusComposerInput();
    };

    barInput.addEventListener('compositionstart', () => {
      composing = true;
      syncSendState();
    });
    barInput.addEventListener('compositionend', () => {
      composing = false;
      syncSendState();
    });
    barInput.addEventListener('input', syncSendState);
    barInput.addEventListener('focus', () => scheduleComposerViewportSync(true));
    barInput.addEventListener('blur', () => scheduleComposerViewportSync(true));
    barInput.addEventListener('keydown', (e) => {
      // Enter confirms a Chinese/Japanese/Korean IME candidate. Chromium and
      // Firefox expose isComposing; keyCode 229 covers Safari's event-ordering
      // edge case where compositionend can precede this keydown.
      if (composing || e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        barInput.blur();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        doSend();
      }
    });
    barSend.addEventListener('click', doSend);
  }

  function openBar(instant = false, focus = true) {
    ensureBar();
    barOpen = true;
    barEl.hidden = false;
    // Resolve the mobile visual-viewport anchor before exposing the entrance
    // frame, so browser chrome or an open keyboard cannot make it jump once.
    applyComposerViewportPosition();
    if (instant) barEl.classList.add('is-instant');
    void barEl.offsetWidth;
    barEl.classList.add('is-on');
    if (instant) {
      void barEl.offsetWidth;
      barEl.classList.remove('is-instant');
    }
    // The default-open composer should be visible without summoning a mobile
    // keyboard or stealing focus. Explicit user opens still focus the field.
    if (focus) focusComposerInput();
    else scheduleComposerViewportSync(true);
    composerLayout = measureComposerLayout();
  }

  function clearBulletDisplay() {
    bulletLayer.replaceChildren();
    clearTimeout(overflowTimer);
    suppressed = 0;
    if (overflowEl) {
      overflowEl.classList.remove('is-on');
      overflowEl.hidden = true;
    }
  }

  // The whole button is the global display state; its moving lanes explain
  // what "on" means without nesting a second switch inside the control.
  function renderBulletMode() {
    if (!bulletModeButton) return;
    bulletModeButton.setAttribute('aria-pressed', String(bulletsOn));
    bulletModeButton.title = bulletsOn ? 'Hide Bullet screen' : 'Show Bullet screen';
  }

  function setBulletMode(next) {
    bulletsOn = Boolean(next);
    try {
      localStorage.setItem('zw-bullets', bulletsOn ? '1' : '0');
    } catch {
      /* fine */
    }
    if (!bulletsOn) clearBulletDisplay();
    renderBulletMode();
  }

  function wireBulletButton(button) {
    if (!button) return;
    bulletModeButton = button;
    button.addEventListener('click', () => {
      setBulletMode(!bulletsOn);
    });
    renderBulletMode();
  }

  // --- cursor chat -----------------------------------------------------------
  //
  // This is a live state, not a message composer: there is no send action.
  // The local native input follows the real pointer; peers render the same
  // state beside the already-shared presence cursor.

  const CURSOR_CHAT_TTL_MS = 5000;
  const CURSOR_CHAT_FADE_MS =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        '--duration-cursor-chat'
      )
    ) || 2000;
  const CURSOR_CHAT_SYNC_MS = 50;
  const CURSOR_CHAT_BLUR_SETTLE_MS = 32;
  const CURSOR_CHAT_MAX_POINTS = 120;
  const CURSOR_CHAT_EDGE = 12;
  const CURSOR_CHAT_GAP_X = 12;
  const CURSOR_CHAT_GAP_Y = 14;
  const CURSOR_CHAT_HINT_GAP_Y = 28;
  const CURSOR_CHAT_MIN_INPUT_PX = 96;
  const CURSOR_CHAT_FLIP_HYSTERESIS = 22;
  const CURSOR_CHAT_CONTROL_TEST_RE = /[\u0000-\u001f\u007f]/u;
  const CURSOR_CHAT_CONTROL_RE = /[\u0000-\u001f\u007f]/gu;
  const CUSTOM_CURSOR_ACTIVE_ATTR = 'data-custom-cursor-active';
  const CUSTOM_CURSOR_DOM_ATTR = 'data-custom-cursor-dom';
  const CUSTOM_CURSOR_STYLE_ATTR = 'data-custom-cursor-style';
  const CUSTOM_CURSOR_SHADOW_STYLE_ATTR = 'data-custom-cursor-shadow-style';
  const CUSTOM_CURSOR_PATH =
    'M5.09 5.36 10.48 20.73c.3.86 1.5.9 1.86.06l2.68-6.24a1 1 0 0 1 .52-.53l6.25-2.67c.83-.36.79-1.56-.07-1.87L6.36 4.09a1 1 0 0 0-1.27 1.27Z';
  const CUSTOM_CURSOR_FILTER = `
    <defs>
      <filter id="site-cursor-shadow" x="0" y="0" width="28" height="28"
        filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feFlood flood-opacity="0" result="BackgroundImageFix"/>
        <feColorMatrix in="SourceAlpha" type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
          result="hardAlpha"/>
        <feOffset dy="1"/>
        <feGaussianBlur stdDeviation="2"/>
        <feComposite in2="hardAlpha" operator="out"/>
        <feColorMatrix type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
        <feBlend mode="normal" in2="BackgroundImageFix" result="cursorShadow"/>
        <feBlend mode="normal" in="SourceGraphic" in2="cursorShadow" result="shape"/>
      </filter>
    </defs>`;
  const CUSTOM_CURSOR_SVG_SOURCE = `
    <svg width="24" height="24" viewBox="0 0 28 28" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#site-cursor-shadow)">
        <path d="${CUSTOM_CURSOR_PATH}" fill="#111114" stroke="#fff"
          stroke-width="2" stroke-linejoin="round"/>
      </g>
      ${CUSTOM_CURSOR_FILTER}
    </svg>`;
  const CUSTOM_CURSOR_CSS_VALUE =
    `url("data:image/svg+xml,${encodeURIComponent(CUSTOM_CURSOR_SVG_SOURCE)}") 4 3, default`;
  const CUSTOM_CURSOR_DOCUMENT_CSS =
    `html[${CUSTOM_CURSOR_ACTIVE_ATTR}],` +
    `html[${CUSTOM_CURSOR_ACTIVE_ATTR}] *{cursor:${CUSTOM_CURSOR_CSS_VALUE}!important}` +
    `html[${CUSTOM_CURSOR_ACTIVE_ATTR}][${CUSTOM_CURSOR_DOM_ATTR}],` +
    `html[${CUSTOM_CURSOR_ACTIVE_ATTR}][${CUSTOM_CURSOR_DOM_ATTR}] *{cursor:none!important}`;
  const CUSTOM_CURSOR_SHADOW_CSS =
    `:host([${CUSTOM_CURSOR_ACTIVE_ATTR}]),` +
    `:host([${CUSTOM_CURSOR_ACTIVE_ATTR}]) *{cursor:${CUSTOM_CURSOR_CSS_VALUE}!important}` +
    `:host([${CUSTOM_CURSOR_ACTIVE_ATTR}][${CUSTOM_CURSOR_DOM_ATTR}]),` +
    `:host([${CUSTOM_CURSOR_ACTIVE_ATTR}][${CUSTOM_CURSOR_DOM_ATTR}]) *{cursor:none!important}`;
  const CUSTOM_CURSOR_SVG = `
    <svg width="24" height="24" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <g filter="url(#site-cursor-shadow)">
        <path d="${CUSTOM_CURSOR_PATH}" fill="currentColor" stroke="#fff"
          stroke-width="2" stroke-linejoin="round"/>
      </g>
      ${CUSTOM_CURSOR_FILTER}
    </svg>`;

  const bootstrapPointer = window.__cursorChatBootstrap?.point;
  const bootstrapPointerValid =
    Number.isFinite(bootstrapPointer?.x) &&
    Number.isFinite(bootstrapPointer?.y);
  let cursorPoint = bootstrapPointerValid
    ? { x: bootstrapPointer.x, y: bootstrapPointer.y }
    : { x: 0, y: 0 };
  let cursorPointValid = bootstrapPointerValid;
  let cursorChatEl = null;
  let cursorChatBubble = null;
  let cursorChatInput = null;
  let cursorChatMeasureContext = null;
  let cursorChatInputWidth = CURSOR_CHAT_MIN_INPUT_PX;
  let cursorChatPendingInputWidth = CURSOR_CHAT_MIN_INPUT_PX;
  let cursorFollowerRenderedX = Number.NaN;
  let cursorFollowerRenderedY = Number.NaN;
  let cursorChatOffsetX = Number.NaN;
  let cursorChatOffsetY = Number.NaN;
  let cursorChatWidth = 124;
  let cursorChatHeight = 35;
  let cursorChatViewportWidth = innerWidth;
  let cursorChatViewportHeight = innerHeight;
  let cursorChatDockTop = innerHeight;
  let cursorChatResizeObserver = null;
  let cursorChatLayoutFrame = null;
  let cursorChatLayoutNeedsMeasure = false;
  let cursorChatRenderFrame = null;
  let cursorChatBootFrame = null;
  let cursorChatWindowBlurTimer = null;
  let cursorChatRefocusFrame = null;
  const customCursorPolicies = new Map();
  const customCursorEditableDocuments = new Set();
  let customCursorRootStyled = false;
  let customCursorRootActive = null;
  let customCursorRootDomFollower = null;
  let cursorChatOpen = false;
  let cursorChatAwaitingBoot = false;
  let cursorChatPendingPreferRight = false;
  let cursorChatPendingOwner = null;
  let cursorPointProvisional = false;
  let cursorChatCursorActive = false;
  let cursorChatFading = false;
  let cursorChatComposing = false;
  let cursorDomHandoffPending = false;
  let cursorDomHandoffReady = false;
  let cursorChatSession = null;
  let cursorChatSequence = 0;
  let cursorChatLastSentAt = -Infinity;
  let cursorChatLastSentText = null;
  let cursorChatPendingText = null;
  let cursorChatSyncTimer = null;
  let cursorChatIdleTimer = null;
  let cursorChatFadeTimer = null;
  let cursorChatSideX = 'right';
  let cursorChatSideY = 'bottom';
  let cursorChatPreferRightUntilFit = false;
  let cursorChatOpenedFromHint = false;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  function createCursorChatSession() {
    try {
      if (crypto.randomUUID) return `cc_${crypto.randomUUID()}`;
      const words = new Uint32Array(3);
      crypto.getRandomValues(words);
      return `cc_${[...words].map((word) => word.toString(36)).join('_')}`;
    } catch {
      return `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    }
  }

  function cleanCursorChatValue(value) {
    const string = String(value || '');
    const withoutControls = CURSOR_CHAT_CONTROL_TEST_RE.test(string)
      ? string.replace(CURSOR_CHAT_CONTROL_RE, '')
      : string;
    if (withoutControls.length <= CURSOR_CHAT_MAX_POINTS) {
      return withoutControls;
    }
    return Array.from(withoutControls).slice(0, CURSOR_CHAT_MAX_POINTS).join('');
  }

  function wireCursorChatValue(value) {
    return typeof value === 'string' && /\S/u.test(value) ? value : '';
  }

  function normalizeCursorChatInput() {
    if (!cursorChatInput) return '';
    const raw = cursorChatInput.value;
    const clean = cleanCursorChatValue(raw);
    if (raw === clean) return clean;

    const start = cursorChatInput.selectionStart ?? raw.length;
    const end = cursorChatInput.selectionEnd ?? start;
    const cleanStart = cleanCursorChatValue(raw.slice(0, start)).length;
    const cleanEnd = cleanCursorChatValue(raw.slice(0, end)).length;
    cursorChatInput.value = clean;
    cursorChatInput.setSelectionRange(
      Math.min(cleanStart, clean.length),
      Math.min(cleanEnd, clean.length)
    );
    return clean;
  }

  function elementUsesTypingCursor(node) {
    if (!node || node.nodeType !== 1 || node.matches?.(':disabled')) return false;
    if (node.isContentEditable) return true;
    if (node.tagName === 'TEXTAREA') return !node.readOnly;
    if (node.tagName !== 'INPUT' || node.readOnly) return false;
    return !/^(?:button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(
      node.type || 'text'
    );
  }

  function documentHasTypingFocus(frameDocument) {
    let active = frameDocument?.activeElement;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    // Cursor Chat owns its follower for the whole session. Do not let a
    // delayed focusout microtask enroll its input in the generic typing set.
    if (active === cursorChatInput) return false;
    return elementUsesTypingCursor(active);
  }

  function cursorDomRequested() {
    return cursorChatCursorActive || customCursorEditableDocuments.size > 0;
  }

  function cursorDomVisible() {
    return (
      finePointer.matches &&
      cursorPointValid &&
      (cursorDomRequested() || cursorDomHandoffPending)
    );
  }

  function cursorFollowerVisible() {
    return (
      finePointer.matches &&
      cursorPointValid &&
      (cursorChatOpen || cursorDomRequested() || cursorDomHandoffPending)
    );
  }

  function syncTypingCursorDocument(frameDocument, focused) {
    const hadFocus = customCursorEditableDocuments.has(frameDocument);
    if (focused) {
      customCursorEditableDocuments.add(frameDocument);
      cursorDomHandoffPending = false;
      cursorDomHandoffReady = false;
    } else {
      customCursorEditableDocuments.delete(frameDocument);
      if (hadFocus && !cursorDomRequested()) {
        cursorDomHandoffPending =
          finePointer.matches && cursorPointValid;
        cursorDomHandoffReady = false;
      }
    }
    if (hadFocus === focused) return;

    ensureCursorChat();
    // Establish visibility and the compositor layer before committing the
    // first transform. This avoids a cold first-focus frame getting stuck.
    syncCursorChatVisibility();
    if (cursorFollowerVisible()) renderCursorChatNow();
    syncCustomCursor();
  }

  function handleTypingCursorFocusIn(frameDocument, event) {
    // Cursor Chat already owns the DOM follower. Letting its autofocus enter
    // the generic typing path would repeat the full cursor-policy sync in the
    // same invocation frame.
    if (event.target === cursorChatInput) return;
    if (!eventTargetsTypingInput(event)) return;
    if (cursorChatPending()) {
      // A new focus target owns the keyboard now. Do not let an earlier,
      // not-yet-rendered "/" intent appear on a later pointer move.
      cancelPendingCursorChat();
    }
    syncTypingCursorDocument(frameDocument, true);
  }

  function handleTypingCursorFocusOut(frameDocument) {
    queueMicrotask(() => {
      syncTypingCursorDocument(
        frameDocument,
        documentHasTypingFocus(frameDocument)
      );
    });
  }

  function ensureCustomCursorDocumentStyle(policy) {
    const frameDocument = policy.document;
    const styleParent = frameDocument.head || frameDocument.documentElement;
    if (!styleParent) return;
    let style = frameDocument.querySelector(`style[${CUSTOM_CURSOR_STYLE_ATTR}]`);
    if (!style) {
      style = frameDocument.createElement('style');
      style.setAttribute(CUSTOM_CURSOR_STYLE_ATTR, '');
      styleParent.appendChild(style);
    }
    if (style.textContent !== CUSTOM_CURSOR_DOCUMENT_CSS) {
      style.textContent = CUSTOM_CURSOR_DOCUMENT_CSS;
    }
    policy.documentStyle = style;
  }

  function ensureCustomCursorShadowStyle(policy, shadowRoot) {
    let style = shadowRoot.querySelector(
      `style[${CUSTOM_CURSOR_SHADOW_STYLE_ATTR}]`
    );
    if (!style) {
      style = policy.document.createElement('style');
      style.setAttribute(CUSTOM_CURSOR_SHADOW_STYLE_ATTR, '');
      shadowRoot.appendChild(style);
    }
    if (style.textContent !== CUSTOM_CURSOR_SHADOW_CSS) {
      style.textContent = CUSTOM_CURSOR_SHADOW_CSS;
    }
  }

  function disposeCustomCursorShadowRoot(policy, shadowRoot, observer) {
    observer?.disconnect();
    shadowRoot.host?.removeAttribute(CUSTOM_CURSOR_ACTIVE_ATTR);
    shadowRoot.host?.removeAttribute(CUSTOM_CURSOR_DOM_ATTR);
    for (const style of shadowRoot.querySelectorAll(
      `style[${CUSTOM_CURSOR_SHADOW_STYLE_ATTR}]`
    )) {
      style.remove();
    }
    policy.shadowObservers.delete(shadowRoot);
  }

  function pruneCustomCursorShadowRoots(policy) {
    for (const [shadowRoot, observer] of policy.shadowObservers) {
      const host = shadowRoot.host;
      if (host?.isConnected && host.ownerDocument === policy.document) continue;
      disposeCustomCursorShadowRoot(policy, shadowRoot, observer);
    }
  }

  function scanCustomCursorNode(policy, node) {
    if (policy.disposed || !node) return;
    if (node.nodeType === 1 && node.shadowRoot?.mode === 'open') {
      registerCustomCursorShadowRoot(policy, node.shadowRoot);
    }
    if (typeof node.querySelectorAll !== 'function') return;
    for (const element of node.querySelectorAll('*')) {
      if (element.shadowRoot?.mode === 'open') {
        registerCustomCursorShadowRoot(policy, element.shadowRoot);
      }
    }
  }

  function registerCustomCursorShadowRoot(policy, shadowRoot) {
    const host = shadowRoot?.host;
    if (
      policy.disposed ||
      shadowRoot?.mode !== 'open' ||
      host?.ownerDocument !== policy.document
    ) {
      return;
    }

    host.toggleAttribute(CUSTOM_CURSOR_ACTIVE_ATTR, policy.active);
    host.toggleAttribute(CUSTOM_CURSOR_DOM_ATTR, policy.domFollower);
    ensureCustomCursorShadowStyle(policy, shadowRoot);
    if (policy.shadowObservers.has(shadowRoot)) return;

    let observer = null;
    const FrameMutationObserver =
      shadowRoot.ownerDocument?.defaultView?.MutationObserver;
    if (typeof FrameMutationObserver === 'function') {
      observer = new FrameMutationObserver((entries) => {
        if (policy.disposed) return;
        ensureCustomCursorShadowStyle(policy, shadowRoot);
        for (const entry of entries) {
          for (const addedNode of entry.addedNodes) {
            scanCustomCursorNode(policy, addedNode);
          }
        }
        pruneCustomCursorShadowRoots(policy);
      });
      try {
        observer.observe(shadowRoot, { childList: true, subtree: true });
      } catch {
        // An iframe can navigate between discovery and observation. Cursor
        // styling is cosmetic, so a stale cross-realm root must fail open.
        observer.disconnect();
        observer = null;
      }
    }
    policy.shadowObservers.set(shadowRoot, observer);
    scanCustomCursorNode(policy, shadowRoot);
  }

  function patchCustomCursorShadowCreation(policy) {
    const prototype = policy.document.defaultView?.Element?.prototype;
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, 'attachShadow')
      : null;
    if (!prototype || typeof descriptor?.value !== 'function') return;

    const original = descriptor.value;
    const patched = function attachShadow(init) {
      const shadowRoot = Reflect.apply(original, this, [init]);
      if (
        shadowRoot?.mode === 'open' &&
        this.ownerDocument === policy.document &&
        this.isConnected &&
        !policy.disposed
      ) {
        try {
          registerCustomCursorShadowRoot(policy, shadowRoot);
        } catch {
          /* cursor policy must never prevent a component from mounting */
        }
      }
      return shadowRoot;
    };

    try {
      Object.defineProperty(prototype, 'attachShadow', {
        ...descriptor,
        value: patched,
      });
      if (prototype.attachShadow === patched) {
        policy.attachShadowPatch = { prototype, descriptor, patched };
      }
    } catch {
      /* document observation still covers connected open shadow roots */
    }
  }

  function installCustomCursorPolicy(frameDocument) {
    // An iframe replacement can invalidate documentElement between the
    // caller's readiness check and this function. Hold the current root so
    // MutationObserver always receives a Node from the same document realm.
    const observedRoot = frameDocument?.documentElement;
    if (!observedRoot) return null;

    let policy = customCursorPolicies.get(frameDocument);
    if (policy) {
      ensureCustomCursorDocumentStyle(policy);
      pruneCustomCursorShadowRoots(policy);
      return policy;
    }

    policy = {
      document: frameDocument,
      documentStyle: null,
      documentObserver: null,
      shadowObservers: new Map(),
      attachShadowPatch: null,
      focusInHandler: null,
      focusOutHandler: null,
      active: false,
      domFollower: false,
      disposed: false,
    };
    customCursorPolicies.set(frameDocument, policy);
    ensureCustomCursorDocumentStyle(policy);
    patchCustomCursorShadowCreation(policy);
    scanCustomCursorNode(policy, observedRoot);
    policy.focusInHandler = (event) =>
      handleTypingCursorFocusIn(frameDocument, event);
    policy.focusOutHandler = () =>
      handleTypingCursorFocusOut(frameDocument);
    frameDocument.addEventListener('focusin', policy.focusInHandler, true);
    frameDocument.addEventListener('focusout', policy.focusOutHandler, true);
    if (documentHasTypingFocus(frameDocument)) {
      syncTypingCursorDocument(frameDocument, true);
    }

    const FrameMutationObserver =
      observedRoot.ownerDocument?.defaultView?.MutationObserver;
    if (typeof FrameMutationObserver === 'function') {
      policy.documentObserver = new FrameMutationObserver((entries) => {
        if (policy.disposed) return;
        ensureCustomCursorDocumentStyle(policy);
        for (const entry of entries) {
          for (const addedNode of entry.addedNodes) {
            scanCustomCursorNode(policy, addedNode);
          }
        }
        pruneCustomCursorShadowRoots(policy);
      });
      try {
        policy.documentObserver.observe(observedRoot, {
          childList: true,
          subtree: true,
        });
      } catch {
        // The frame was replaced while its policy was being installed.
        policy.documentObserver.disconnect();
        policy.documentObserver = null;
      }
    }
    return policy;
  }

  function setCustomCursorPolicyMode(policy, active, domFollower) {
    if (policy.active === active && policy.domFollower === domFollower) return;
    policy.active = active;
    policy.domFollower = domFollower;
    policy.document.documentElement?.toggleAttribute(
      CUSTOM_CURSOR_ACTIVE_ATTR,
      active
    );
    policy.document.documentElement?.toggleAttribute(
      CUSTOM_CURSOR_DOM_ATTR,
      domFollower
    );
    for (const shadowRoot of policy.shadowObservers.keys()) {
      shadowRoot.host?.toggleAttribute(CUSTOM_CURSOR_ACTIVE_ATTR, active);
      shadowRoot.host?.toggleAttribute(CUSTOM_CURSOR_DOM_ATTR, domFollower);
    }
  }

  function customCursorPolicyIsConnected(policy) {
    try {
      const frame = policy.document.defaultView?.frameElement;
      return Boolean(
        frame?.isConnected && frame.contentDocument === policy.document
      );
    } catch {
      return false;
    }
  }

  function disposeCustomCursorPolicy(policy) {
    policy.disposed = true;
    policy.documentObserver?.disconnect();
    if (policy.focusInHandler) {
      policy.document.removeEventListener(
        'focusin',
        policy.focusInHandler,
        true
      );
    }
    if (policy.focusOutHandler) {
      policy.document.removeEventListener(
        'focusout',
        policy.focusOutHandler,
        true
      );
    }
    const hadTypingFocus = customCursorEditableDocuments.delete(policy.document);
    if (hadTypingFocus && !cursorDomRequested()) {
      cursorDomHandoffPending =
        finePointer.matches && cursorPointValid;
      cursorDomHandoffReady = false;
    }
    policy.document.documentElement?.removeAttribute(CUSTOM_CURSOR_ACTIVE_ATTR);
    policy.document.documentElement?.removeAttribute(CUSTOM_CURSOR_DOM_ATTR);
    for (const [shadowRoot, observer] of [...policy.shadowObservers]) {
      disposeCustomCursorShadowRoot(policy, shadowRoot, observer);
    }
    for (const style of policy.document.querySelectorAll(
      `style[${CUSTOM_CURSOR_STYLE_ATTR}]`
    )) {
      style.remove();
    }

    const patch = policy.attachShadowPatch;
    if (patch?.prototype.attachShadow === patch.patched) {
      try {
        Object.defineProperty(patch.prototype, 'attachShadow', patch.descriptor);
      } catch {
        /* a discarded document no longer needs restoration to stay usable */
      }
    }
    customCursorPolicies.delete(policy.document);
    if (hadTypingFocus) {
      syncCursorChatVisibility();
      if (cursorDomVisible()) scheduleCursorChatRender();
    }
  }

  function releaseCustomCursorFrame(frame) {
    try {
      const frameDocument = frame?.contentDocument;
      const policy = frameDocument && customCursorPolicies.get(frameDocument);
      if (policy) disposeCustomCursorPolicy(policy);
    } catch {
      /* a detached or cross-origin frame has no local policy to release */
    }
  }

  function syncCustomCursor(frame = null) {
    const policyActive = finePointer.matches;
    const domFollower = cursorDomVisible();
    if (!customCursorRootStyled) {
      document.documentElement.style.setProperty(
        '--site-custom-cursor',
        CUSTOM_CURSOR_CSS_VALUE
      );
      customCursorRootStyled = true;
    }
    const modeChanged =
      customCursorRootActive !== policyActive ||
      customCursorRootDomFollower !== domFollower;
    if (modeChanged) {
      customCursorRootActive = policyActive;
      customCursorRootDomFollower = domFollower;
      document.documentElement.classList.toggle(
        'has-custom-cursor',
        policyActive
      );
      document.documentElement.classList.toggle('has-dom-cursor', domFollower);

      for (const policy of [...customCursorPolicies.values()]) {
        if (!customCursorPolicyIsConnected(policy)) {
          disposeCustomCursorPolicy(policy);
        } else {
          setCustomCursorPolicyMode(policy, policyActive, domFollower);
        }
      }
    }

    if (frame) {
      try {
        const frameDocument = frame.contentDocument;
        if (!frameDocument?.documentElement) return;
        const policy = installCustomCursorPolicy(frameDocument);
        if (!policy) return;
        setCustomCursorPolicyMode(
          policy,
          policyActive,
          cursorDomVisible()
        );
      } catch {
        /* cross-origin frames keep their own cursor policy */
      }
    }
  }

  function ensureCursorChat() {
    if (cursorChatEl) return;
    cursorChatEl = document.createElement('div');
    cursorChatEl.id = 'cursor-chat-composer';
    cursorChatEl.className = 'cursor-chat-local';
    cursorChatEl.inert = true;
    cursorChatEl.setAttribute('aria-hidden', 'true');
    cursorChatEl.innerHTML =
      `<div class="site-cursor" aria-hidden="true">${CUSTOM_CURSOR_SVG}</div>
      <div class="cursor-chat-bubble cursor-chat-local-bubble">
        <input class="cursor-chat-input" type="text" placeholder="Say something"
          aria-label="Cursor chat message" autocomplete="off" autocorrect="off"
          autocapitalize="off" spellcheck="false" tabindex="-1" />
      </div>`;
    cursorChatBubble = cursorChatEl.querySelector('.cursor-chat-bubble');
    cursorChatInput = cursorChatEl.querySelector('.cursor-chat-input');
    document.body.appendChild(cursorChatEl);
    cursorChatMeasureContext = document.createElement('canvas').getContext('2d');
    syncCursorChatMeasureFont();
    document.fonts?.ready?.then(() => {
      syncCursorChatMeasureFont();
      if (cursorChatOpen) measureCursorChat();
    });

    if (typeof ResizeObserver === 'function') {
      cursorChatResizeObserver = new ResizeObserver((entries) => {
        let shouldPosition = false;
        for (const entry of entries) {
          if (entry.target === barEl) {
            refreshCursorChatLayout();
            shouldPosition = true;
            continue;
          }
          if (entry.target !== cursorChatBubble) continue;
          const borderBox = Array.isArray(entry.borderBoxSize)
            ? entry.borderBoxSize[0]
            : entry.borderBoxSize;
          const borderWidth = Number(borderBox?.inlineSize);
          const borderHeight = Number(borderBox?.blockSize);
          const contentWidth = Number(entry.contentRect?.width);
          const contentHeight = Number(entry.contentRect?.height);
          const width = borderWidth > 0 ? borderWidth : contentWidth + 26;
          const height = borderHeight > 0 ? borderHeight : contentHeight + 14;
          if (!(width > 0 && height > 0)) continue;
          cursorChatWidth = width;
          cursorChatHeight = height;
          shouldPosition = true;
        }
        if (shouldPosition) scheduleCursorChatRender();
      });
      cursorChatResizeObserver.observe(cursorChatBubble);
      if (barEl) cursorChatResizeObserver.observe(barEl);
    }

    cursorChatInput.addEventListener('compositionstart', () => {
      if (!cursorChatOpen) return;
      reviveCursorChat();
      cursorChatComposing = true;
      clearTimeout(cursorChatIdleTimer);
      cursorChatIdleTimer = null;
    });
    cursorChatInput.addEventListener('compositionend', () => {
      if (!cursorChatOpen) return;
      cursorChatComposing = false;
      reviveCursorChat();
      const value = normalizeCursorChatInput();
      measureCursorChat();
      queueCursorChatSync(value, true);
      scheduleCursorChatExpiry();
    });
    cursorChatInput.addEventListener('input', (event) => {
      if (!cursorChatOpen) return;
      reviveCursorChat();
      if (cursorChatComposing || event.isComposing) {
        // The browser owns the provisional IME value and candidate window.
        // Render it locally, but do not leak or normalize it until commit.
        measureCursorChat();
        return;
      }
      const value = normalizeCursorChatInput();
      measureCursorChat();
      queueCursorChatSync(value);
      scheduleCursorChatExpiry();
    });
    cursorChatInput.addEventListener('keydown', (event) => {
      // Enter/Escape belong to the IME while a candidate is active. keyCode
      // 229 covers Safari's compositionend-before-keydown ordering.
      if (cursorChatComposing || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        reviveCursorChat();
        cursorChatInput.value = '';
        measureCursorChat();
        queueCursorChatSync('', true);
        scheduleCursorChatExpiry();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeCursorChat();
      }
    });
  }

  function cancelPendingCursorChat(owner) {
    if (
      arguments.length > 0 &&
      cursorChatPendingOwner !== owner
    ) {
      return false;
    }
    if (cursorChatBootFrame !== null) {
      cancelAnimationFrame(cursorChatBootFrame);
      cursorChatBootFrame = null;
    }
    cursorChatAwaitingBoot = false;
    cursorChatPendingPreferRight = false;
    cursorChatPendingOwner = null;
    return true;
  }

  function cursorChatPending() {
    return cursorChatAwaitingBoot;
  }

  function resolvePendingCursorChat() {
    if (!cursorChatPending() || cursorChatOpen) return;
    cursorChatAwaitingBoot = bootInProgress();
    if (cursorChatPending()) return;
    const preferRightUntilFit = cursorChatPendingPreferRight;
    openCursorChat({ preferRightUntilFit });
  }

  function schedulePendingCursorChatResolve() {
    if (!cursorChatPending() || cursorChatBootFrame !== null) return;
    cursorChatBootFrame = requestAnimationFrame(() => {
      cursorChatBootFrame = null;
      // Boot completion also reveals the bottom composer. Read its final box
      // in a clean frame before Cursor Chat performs any visibility writes.
      refreshCursorChatLayout();
      resolvePendingCursorChat();
    });
  }

  function placeCursorChatFallback() {
    const viewport = window.visualViewport;
    const width = viewport?.width || innerWidth;
    const height = viewport?.height || innerHeight;
    cursorPoint.x = Math.round(width / 2);
    cursorPoint.y = Math.round(height / 2);
    cursorPointValid = true;
    cursorPointProvisional = true;
  }

  function syncCursorChatMeasureFont() {
    if (!cursorChatInput || !cursorChatMeasureContext) return;
    const style = getComputedStyle(cursorChatInput);
    cursorChatMeasureContext.font =
      style.font ||
      `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    cursorChatMeasureContext.fontKerning = 'normal';
  }

  function measureCursorChat(schedule = true) {
    if (!cursorChatOpen || !cursorChatInput) return;
    const sample = cursorChatInput.value || cursorChatInput.placeholder;
    const measuredWidth = cursorChatMeasureContext
      ? cursorChatMeasureContext.measureText(sample).width
      : Array.from(sample).length * 15;
    const textWidth = Math.ceil(measuredWidth);
    const maxInputWidth = Math.max(
      CURSOR_CHAT_MIN_INPUT_PX,
      Math.min(300, cursorChatViewportWidth - CURSOR_CHAT_EDGE * 2 - 26)
    );
    const minInputWidth = Math.min(CURSOR_CHAT_MIN_INPUT_PX, maxInputWidth);
    cursorChatPendingInputWidth = clamp(
      textWidth + 2,
      minInputWidth,
      maxInputWidth
    );
    cursorChatWidth = cursorChatPendingInputWidth + 26;
    cursorChatHeight = 33;
    if (schedule) scheduleCursorChatRender();
  }

  function scheduleCursorChatRender() {
    if (!cursorFollowerVisible() || cursorChatRenderFrame !== null) return;
    cursorChatRenderFrame = requestAnimationFrame(() => {
      cursorChatRenderFrame = null;
      renderCursorChat();
    });
  }

  function renderCursorChat() {
    if (!cursorFollowerVisible() || !cursorChatEl) return;
    if (
      cursorChatOpen &&
      cursorChatInput &&
      cursorChatPendingInputWidth !== cursorChatInputWidth
    ) {
      cursorChatInputWidth = cursorChatPendingInputWidth;
      cursorChatInput.style.setProperty(
        '--cursor-chat-input-width',
        `${cursorChatInputWidth}px`
      );
    }
    positionCursorFollower();
    if (cursorChatOpen) positionCursorChat();
    if (
      cursorDomHandoffPending &&
      cursorDomHandoffReady &&
      !cursorDomRequested()
    ) {
      cursorDomHandoffPending = false;
      cursorDomHandoffReady = false;
      syncCursorChatVisibility();
      syncCustomCursor();
    }
  }

  function renderCursorChatNow() {
    if (cursorChatRenderFrame !== null) {
      cancelAnimationFrame(cursorChatRenderFrame);
      cursorChatRenderFrame = null;
    }
    renderCursorChat();
  }

  function cancelCursorChatRender() {
    if (cursorChatRenderFrame !== null) {
      cancelAnimationFrame(cursorChatRenderFrame);
      cursorChatRenderFrame = null;
    }
  }

  function refreshCursorChatLayout() {
    const viewport = window.visualViewport;
    cursorChatViewportWidth = viewport?.width || innerWidth;
    cursorChatViewportHeight = viewport?.height || innerHeight;
    const dockRect = barEl && !barEl.hidden ? barEl.getBoundingClientRect() : null;
    cursorChatDockTop = dockRect?.top ?? cursorChatViewportHeight;
  }

  function scheduleCursorChatLayoutRefresh(measure = false) {
    cursorChatLayoutNeedsMeasure ||= measure;
    if (cursorChatLayoutFrame !== null) return;
    cursorChatLayoutFrame = requestAnimationFrame(() => {
      cursorChatLayoutFrame = null;
      const shouldMeasure = cursorChatLayoutNeedsMeasure;
      cursorChatLayoutNeedsMeasure = false;
      refreshCursorChatLayout();
      if (cursorPointProvisional) placeCursorChatFallback();
      if (shouldMeasure) measureCursorChat();
      scheduleCursorChatRender();
    });
  }

  function positionCursorChat(allowFlip = !cursorChatComposing) {
    if (!cursorChatOpen || !cursorChatEl) return;
    const width = cursorChatWidth;
    const height = cursorChatHeight;
    const gapY = cursorChatOpenedFromHint
      ? CURSOR_CHAT_HINT_GAP_Y
      : CURSOR_CHAT_GAP_Y;
    const bottomEdge = Math.max(
      CURSOR_CHAT_EDGE + height,
      Math.min(
        cursorChatViewportHeight - CURSOR_CHAT_EDGE,
        cursorChatDockTop - CURSOR_CHAT_EDGE
      )
    );

    if (allowFlip) {
      const rightX = cursorPoint.x + CURSOR_CHAT_GAP_X;
      const leftX = cursorPoint.x - CURSOR_CHAT_GAP_X - width;
      const rightFits =
        rightX + width <= cursorChatViewportWidth - CURSOR_CHAT_EDGE;
      const leftFits = leftX >= CURSOR_CHAT_EDGE;
      const rightOverflow =
        rightX + width - (cursorChatViewportWidth - CURSOR_CHAT_EDGE);
      const leftOverflow = CURSOR_CHAT_EDGE - leftX;

      // Preserve the current side through the boundary zone. A side change
      // only happens once the current placement is meaningfully clipped and
      // the opposite side can fit, preventing 1px pointer jitter from making
      // the input bounce back and forth.
      if (cursorChatPreferRightUntilFit && rightFits) {
        cursorChatPreferRightUntilFit = false;
      }
      if (!cursorChatPreferRightUntilFit) {
        if (
          cursorChatSideX === 'right' &&
          rightOverflow >= CURSOR_CHAT_FLIP_HYSTERESIS &&
          leftFits
        ) {
          cursorChatSideX = 'left';
        } else if (
          cursorChatSideX === 'left' &&
          leftOverflow >= CURSOR_CHAT_FLIP_HYSTERESIS &&
          rightFits
        ) {
          cursorChatSideX = 'right';
        }
      }

      const bottomY = cursorPoint.y + gapY;
      const topY = cursorPoint.y - gapY - height;
      const bottomFits = bottomY + height <= bottomEdge;
      const topFits = topY >= CURSOR_CHAT_EDGE;
      const bottomOverflow = bottomY + height - bottomEdge;
      const topOverflow = CURSOR_CHAT_EDGE - topY;
      if (
        cursorChatSideY === 'bottom' &&
        bottomOverflow >= CURSOR_CHAT_FLIP_HYSTERESIS &&
        topFits
      ) {
        cursorChatSideY = 'top';
      } else if (
        cursorChatSideY === 'top' &&
        topOverflow >= CURSOR_CHAT_FLIP_HYSTERESIS &&
        bottomFits
      ) {
        cursorChatSideY = 'bottom';
      }
    }

    const idealX =
      cursorChatSideX === 'right'
        ? cursorPoint.x + CURSOR_CHAT_GAP_X
        : cursorPoint.x - CURSOR_CHAT_GAP_X - width;
    const idealY =
      cursorChatSideY === 'bottom'
        ? cursorPoint.y + gapY
        : cursorPoint.y - gapY - height;
    const x = clamp(
      idealX,
      CURSOR_CHAT_EDGE,
      cursorChatViewportWidth - width - CURSOR_CHAT_EDGE
    );
    const y = clamp(idealY, CURSOR_CHAT_EDGE, bottomEdge - height);

    // The outer follower owns the pointer position. The bubble only carries a
    // relative offset, so moving in the open viewport needs no layout read.
    const pixelRatio = Math.max(1, devicePixelRatio || 1);
    const offsetX = Math.round((x - cursorPoint.x) * pixelRatio) / pixelRatio;
    const offsetY = Math.round((y - cursorPoint.y) * pixelRatio) / pixelRatio;
    if (offsetX === cursorChatOffsetX && offsetY === cursorChatOffsetY) return;
    cursorChatOffsetX = offsetX;
    cursorChatOffsetY = offsetY;
    cursorChatBubble.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
  }

  function positionCursorFollower() {
    if (
      !cursorPointValid ||
      !cursorChatEl ||
      !cursorFollowerVisible()
    ) {
      return;
    }
    const pixelRatio = Math.max(1, devicePixelRatio || 1);
    const x = Math.round(cursorPoint.x * pixelRatio) / pixelRatio;
    const y = Math.round(cursorPoint.y * pixelRatio) / pixelRatio;
    if (x === cursorFollowerRenderedX && y === cursorFollowerRenderedY) return;
    cursorFollowerRenderedX = x;
    cursorFollowerRenderedY = y;
    cursorChatEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function syncCursorChatVisibility() {
    if (!cursorChatEl) return;
    const visible = cursorFollowerVisible();
    const domCursorVisible = cursorDomVisible();
    cursorChatEl.classList.toggle('is-active', visible);
    cursorChatEl.classList.toggle('is-dom-cursor-active', domCursorVisible);
    cursorChatEl.classList.toggle('is-chat-active', cursorChatOpen);
    cursorChatEl.inert = !cursorChatOpen;
    cursorChatEl.setAttribute('aria-hidden', String(!cursorChatOpen));
  }

  function trackPointer(x, y, activatePendingChat = true) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const hadPendingChat = cursorChatPending();
    const shouldOpenPendingChat =
      activatePendingChat && hadPendingChat && !cursorChatOpen;
    if (hadPendingChat) {
      if (!activatePendingChat) {
        cancelPendingCursorChat();
      }
    }
    const wasFollowerVisible = cursorFollowerVisible();
    cursorPoint.x = x;
    cursorPoint.y = y;
    cursorPointValid = true;
    cursorPointProvisional = false;

    // Cursor Chat and ordinary focused text inputs use the DOM arrow because
    // operating systems can suppress the native cursor while typing. Either
    // way, high-polling events collapse into one transform write per frame.
    if (cursorFollowerVisible()) {
      if (cursorDomHandoffPending && !cursorDomRequested()) {
        cursorDomHandoffReady = true;
      }
      if (!wasFollowerVisible) {
        syncCursorChatVisibility();
        renderCursorChatNow();
        syncCustomCursor();
      } else {
        scheduleCursorChatRender();
      }
    }
    if (shouldOpenPendingChat) resolvePendingCursorChat();
  }

  function cancelCursorChatSync() {
    clearTimeout(cursorChatSyncTimer);
    cursorChatSyncTimer = null;
    cursorChatPendingText = null;
  }

  function sendCursorChatNow(text, allowDuplicate = false) {
    if (!cursorChatSession) return;
    if (!allowDuplicate && text === cursorChatLastSentText) return;
    cursorChatLastSentAt = performance.now();
    cursorChatLastSentText = text;
    presence?.cursorChat?.({
      session: cursorChatSession,
      seq: ++cursorChatSequence,
      text,
      x: cursorPoint.x,
      y: cursorPoint.y,
      ttlMs: CURSOR_CHAT_TTL_MS,
    });
  }

  function flushCursorChatSync() {
    cursorChatSyncTimer = null;
    if (!cursorChatOpen || cursorChatPendingText === null) return;
    const value = cursorChatPendingText;
    cursorChatPendingText = null;
    sendCursorChatNow(value);
  }

  function queueCursorChatSync(value, immediate = false) {
    if (!cursorChatOpen) return;
    const text = wireCursorChatValue(value);
    if (immediate) {
      cancelCursorChatSync();
      sendCursorChatNow(text);
      return;
    }

    const elapsed = performance.now() - cursorChatLastSentAt;
    if (elapsed >= CURSOR_CHAT_SYNC_MS) {
      cancelCursorChatSync();
      sendCursorChatNow(text);
      return;
    }

    cursorChatPendingText = text;
    if (cursorChatSyncTimer === null) {
      cursorChatSyncTimer = setTimeout(
        flushCursorChatSync,
        Math.max(0, CURSOR_CHAT_SYNC_MS - elapsed)
      );
    }
  }

  function scheduleCursorChatExpiry() {
    clearTimeout(cursorChatIdleTimer);
    cursorChatIdleTimer = setTimeout(() => {
      cursorChatIdleTimer = null;
      if (!cursorChatComposing) beginCursorChatFade();
    }, CURSOR_CHAT_TTL_MS);
  }

  function releaseCursorChatCursor() {
    const shouldHandoff =
      cursorChatCursorActive &&
      customCursorEditableDocuments.size === 0 &&
      finePointer.matches &&
      cursorPointValid;
    cursorChatCursorActive = false;
    if (shouldHandoff) {
      cursorDomHandoffPending = true;
      cursorDomHandoffReady = false;
    }
    return shouldHandoff;
  }

  function reviveCursorChat() {
    if (!cursorChatFading) return;
    clearTimeout(cursorChatFadeTimer);
    cursorChatFadeTimer = null;
    cursorChatFading = false;
    cursorChatBubble.classList.remove('is-out');
  }

  function finishCursorChat() {
    const chatCursorHandedOff = releaseCursorChatCursor();
    clearTimeout(cursorChatIdleTimer);
    clearTimeout(cursorChatFadeTimer);
    cancelCursorChatSync();
    cancelCursorChatRender();
    if (cursorChatRefocusFrame !== null) {
      cancelAnimationFrame(cursorChatRefocusFrame);
      cursorChatRefocusFrame = null;
    }
    cursorChatIdleTimer = null;
    cursorChatFadeTimer = null;
    cursorChatOpen = false;
    cursorChatFading = false;
    cursorChatComposing = false;
    cursorChatBubble?.classList.remove('is-out');
    if (document.activeElement === cursorChatInput) cursorChatInput.blur();
    if (cursorChatInput) cursorChatInput.value = '';
    cursorChatSession = null;
    cursorChatLastSentText = null;
    cursorChatPreferRightUntilFit = false;
    cursorChatOpenedFromHint = false;
    if (!cursorDomRequested() && !chatCursorHandedOff) {
      // With no valid pointer to align, release the follower immediately.
      // Otherwise the next real pointer frame performs a seamless handoff.
      cursorDomHandoffPending = false;
      cursorDomHandoffReady = false;
    }
    chatHint?.setAttribute('aria-expanded', 'false');
    if (chatHint) {
      chatHint.title = 'Open cursor chat';
      chatHint.setAttribute('aria-label', 'Open cursor chat');
    }
    syncCursorChatVisibility();
    if (cursorFollowerVisible()) renderCursorChatNow();
    syncCustomCursor();
  }

  function beginCursorChatFade() {
    if (!cursorChatOpen || cursorChatFading || cursorChatComposing) return;
    cursorChatFading = true;
    cursorChatBubble.classList.add('is-out');
    const session = cursorChatSession;
    const finishFade = () => {
      if (cursorChatSession === session && cursorChatFading) {
        cancelCursorChatSync();
        sendCursorChatNow('', true);
        finishCursorChat();
      }
    };
    cursorChatFadeTimer = setTimeout(finishFade, CURSOR_CHAT_FADE_MS);
  }

  function closeCursorChat() {
    closeCursorChatImmediately();
  }

  function closeCursorChatImmediately() {
    cancelPendingCursorChat();
    if (!cursorChatOpen) return;
    if (cursorChatOpen) {
      cancelCursorChatSync();
      sendCursorChatNow('', true);
    }
    finishCursorChat(false);
  }

  function openCursorChat(point) {
    if (!finePointer.matches) return false;
    const preferRightUntilFit = Boolean(point?.preferRightUntilFit);
    const pendingOwner = point?.pendingOwner ?? null;
    const requiresPointer =
      point?.requireFreshPointer === true || !cursorPointValid;
    if (cursorChatOpen && requiresPointer) closeCursorChatImmediately();
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      cancelPendingCursorChat();
      trackPointer(point.x, point.y, false);
    } else if (requiresPointer) {
      // Keyboard events do not expose pointer coordinates. A deterministic
      // center anchor keeps "/" reliable; the next real sample replaces it
      // without animation or layout work.
      placeCursorChatFallback();
    }
    cursorChatAwaitingBoot = bootInProgress();
    if (cursorChatPending()) {
      cursorChatPendingPreferRight = preferRightUntilFit;
      cursorChatPendingOwner = pendingOwner;
      return true;
    }
    cancelPendingCursorChat();
    if (cursorChatOpen) closeCursorChatImmediately();
    ensureCursorChat();

    cursorChatSession = createCursorChatSession();
    cursorChatLastSentAt = -Infinity;
    cursorChatLastSentText = null;
    cursorChatSideX = 'right';
    cursorChatSideY = 'bottom';
    cursorChatPreferRightUntilFit = preferRightUntilFit;
    cursorChatOpenedFromHint = cursorChatPreferRightUntilFit;
    cursorFollowerRenderedX = Number.NaN;
    cursorFollowerRenderedY = Number.NaN;
    cursorChatOffsetX = Number.NaN;
    cursorChatOffsetY = Number.NaN;
    cursorChatOpen = true;
    cursorChatCursorActive = true;
    cursorChatFading = false;
    cursorChatComposing = false;
    cursorDomHandoffPending = false;
    cursorDomHandoffReady = false;
    cursorChatInput.value = '';
    cursorChatBubble.classList.remove('is-out');
    // The follower and bubble are layout-resident, transparent compositor
    // layers from boot. Opening only flips visibility and transform state.
    syncCursorChatVisibility();
    measureCursorChat(false);
    renderCursorChatNow();
    syncCustomCursor();
    cursorChatInput.focus({ preventScroll: true });
    scheduleCursorChatExpiry();
    chatHint?.setAttribute('aria-expanded', 'true');
    if (chatHint) {
      chatHint.title = 'Restart cursor chat';
      chatHint.setAttribute('aria-label', 'Restart cursor chat');
    }
    return true;
  }

  function isCursorChatOpen() {
    return cursorChatOpen || cursorChatPending();
  }

  function consumeCursorChatBootstrap() {
    const bootstrap = window.__cursorChatBootstrap;
    if (!bootstrap) return;

    // Read the latest values before removing the capture listeners. JavaScript
    // runs this handoff atomically, so an input event belongs to exactly one
    // side of the bridge.
    const point = bootstrap.point;
    const slashRequested = bootstrap.slash === true;
    bootstrap.slash = false;
    bootstrap.dispose?.();
    try {
      delete window.__cursorChatBootstrap;
    } catch {
      window.__cursorChatBootstrap = null;
    }

    if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
      trackPointer(point.x, point.y, false);
    }
    if (slashRequested && !documentHasTypingFocus(document)) {
      openCursorChat();
    }
  }

  function eventTargetsEditable(event) {
    const path =
      typeof event.composedPath === 'function'
        ? event.composedPath()
        : [event.target];
    return path.some((node) => {
      if (!node || node.nodeType !== 1) return false;
      return (
        node.tagName === 'INPUT' ||
        node.tagName === 'TEXTAREA' ||
        node.tagName === 'SELECT' ||
        node.isContentEditable
      );
    });
  }

  function eventTargetsTypingInput(event) {
    const path =
      typeof event.composedPath === 'function'
        ? event.composedPath()
        : [event.target];
    return path.some(elementUsesTypingCursor);
  }

  function resetCursorChatForPageExit() {
    clearTimeout(cursorChatWindowBlurTimer);
    cursorChatWindowBlurTimer = null;
    if (cursorChatRefocusFrame !== null) {
      cancelAnimationFrame(cursorChatRefocusFrame);
      cursorChatRefocusFrame = null;
    }
    const wasOpen = cursorChatOpen;
    cancelPendingCursorChat();
    cursorPointValid = false;
    cursorPointProvisional = false;
    cursorDomHandoffPending = false;
    cursorDomHandoffReady = false;
    if (wasOpen) {
      closeCursorChatImmediately();
      return;
    }
    syncCursorChatVisibility();
    syncCustomCursor();
  }

  function cancelCursorChatWindowBlur() {
    clearTimeout(cursorChatWindowBlurTimer);
    cursorChatWindowBlurTimer = null;
  }

  function handleCursorChatWindowFocus() {
    cancelCursorChatWindowBlur();
    if (!cursorChatOpen || cursorChatRefocusFrame !== null) return;
    cursorChatRefocusFrame = requestAnimationFrame(() => {
      cursorChatRefocusFrame = null;
      if (
        cursorChatOpen &&
        document.hasFocus() &&
        document.activeElement !== cursorChatInput
      ) {
        cursorChatInput.focus({ preventScroll: true });
      }
    });
  }

  function scheduleCursorChatWindowBlur() {
    cancelCursorChatWindowBlur();
    cursorChatWindowBlurTimer = setTimeout(() => {
      cursorChatWindowBlurTimer = null;
      // Same-origin iframe focus transiently blurs the parent Window while the
      // top document still owns focus. Let that sequence settle before treating
      // it as a real tab/app exit.
      if (document.hasFocus()) return;
      resetCursorChatForPageExit();
    }, CURSOR_CHAT_BLUR_SETTLE_MS);
  }

  document.addEventListener(
    'focusin',
    (event) => handleTypingCursorFocusIn(document, event),
    true
  );
  document.addEventListener(
    'focusout',
    () => handleTypingCursorFocusOut(document),
    true
  );

  addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      const samples = event.getCoalescedEvents?.();
      const latest = samples?.length ? samples[samples.length - 1] : event;
      trackPointer(latest.clientX, latest.clientY);
    },
    { passive: true }
  );
  document.documentElement.addEventListener(
    'pointerover',
    (event) => {
      // pointerover is the most reliable first sample after a fresh document
      // becomes interactive. Once a valid point exists, this path is inert.
      if (cursorPointValid) return;
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
        return;
      }
      trackPointer(event.clientX, event.clientY);
    },
    { passive: true }
  );
  document.documentElement.addEventListener(
    'pointerenter',
    (event) => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
        return;
      }
      trackPointer(event.clientX, event.clientY);
    },
    { passive: true }
  );
  document.documentElement.addEventListener(
    'pointerleave',
    (event) => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
        return;
      }
      if (event.relatedTarget !== null) return;
      cancelPendingCursorChat();
      cursorPointValid = false;
      cursorPointProvisional = false;
      cursorDomHandoffPending = false;
      cursorDomHandoffReady = false;
      closeCursorChatImmediately();
      syncCursorChatVisibility();
      syncCustomCursor();
    },
    { passive: true }
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !event.pointerType ||
        event.pointerType === 'mouse' ||
        event.pointerType === 'pen'
      ) {
        trackPointer(event.clientX, event.clientY, false);
      } else {
        cancelPendingCursorChat();
      }
      if (cursorChatOpen) closeCursorChat();
    },
    { capture: true, passive: true }
  );
  addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      (cursorChatOpen || cursorChatPending()) &&
      !event.defaultPrevented &&
      !cursorChatComposing &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      closeCursorChatImmediately();
      return;
    }
    if (
      event.key !== '/' ||
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.isComposing ||
      event.keyCode === 229 ||
      eventTargetsEditable(event)
    ) {
      return;
    }
    if (!finePointer.matches) return;
    event.preventDefault();
    openCursorChat();
  });
  addEventListener(
    'resize',
    () => scheduleCursorChatLayoutRefresh(true),
    { passive: true }
  );
  addEventListener('boot:done', schedulePendingCursorChatResolve);
  window.visualViewport?.addEventListener(
    'resize',
    () => scheduleCursorChatLayoutRefresh(true),
    { passive: true }
  );
  window.visualViewport?.addEventListener(
    'scroll',
    () => scheduleCursorChatLayoutRefresh(),
    { passive: true }
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resetCursorChatForPageExit();
    }
  });
  addEventListener('blur', scheduleCursorChatWindowBlur);
  addEventListener('focus', handleCursorChatWindowFocus);
  finePointer.addEventListener('change', (event) => {
    if (!event.matches) {
      cancelPendingCursorChat();
      cursorPointValid = false;
      cursorPointProvisional = false;
      cursorDomHandoffPending = false;
      cursorDomHandoffReady = false;
      closeCursorChatImmediately();
    }
    syncCustomCursor();
    syncCursorChatVisibility();
  });

  // Keep the controlled input stable across every open/close cycle and make
  // the topbar's aria-controls target available before first interaction.
  ensureCursorChat();
  refreshCursorChatLayout();
  if (documentHasTypingFocus(document)) {
    syncTypingCursorDocument(document, true);
  }
  consumeCursorChatBootstrap();
  syncCustomCursor();

  // Topbar hint chip: another way in, for people who never guess "/".
  chatHint?.addEventListener('click', (event) => {
    openCursorChat({
      x: event.clientX,
      y: event.clientY,
      preferRightUntilFit: true,
    });
  });

  // Bullet chat is persistent chrome after boot, but it must not peek around
  // the loader while that surface scales down. The boot completion event
  // releases one short, GPU-only entrance from below; a deliberate boot skip
  // keeps the dock instant.
  let socialChromeReady = false;
  let socialChromeBootObserver = null;
  const revealSocialChrome = (instant = false) => {
    if (socialChromeReady) return;
    socialChromeReady = true;
    socialChromeBootObserver?.disconnect();
    socialChromeBootObserver = null;
    openBar(instant, false);
  };

  if (bootInProgress()) {
    ensureBar();
    addEventListener('boot:done', () => revealSocialChrome(false), {
      once: true,
    });
    // The head-level dead-man's switch normally emits boot:done too. Watching
    // the root class keeps this component fail-open even if an older cached
    // document or a partially loaded boot script only clears the state.
    socialChromeBootObserver = new MutationObserver(() => {
      if (!bootInProgress()) {
        schedulePendingCursorChatResolve();
        revealSocialChrome(false);
      }
    });
    try {
      socialChromeBootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    } catch {
      socialChromeBootObserver.disconnect();
      socialChromeBootObserver = null;
    }
  } else {
    revealSocialChrome(true);
  }

  // --- wiring ---------------------------------------------------------------

  return {
    location: sharedLocation,
    bind(p) {
      presence = p;
      if (cursorChatOpen && cursorChatInput) {
        cursorChatLastSentAt = -Infinity;
        cursorChatLastSentText = null;
        queueCursorChatSync(cursorChatInput.value, true);
      }
    },
    onSelf({ color }) {
      selfColor = color;
      syncMarkerEntries();
    },
    onLocations(list) {
      peerLocations = Array.isArray(list) ? list : [];
      syncMarkerEntries();
    },
    onBullet({ text }) {
      spawnBullet(text, false);
    },
    openCursorChat,
    closeCursorChat,
    cancelCursorChatPending: cancelPendingCursorChat,
    trackPointer,
    syncCustomCursor,
    releaseCustomCursorFrame,
    isCursorChatOpen,
  };
})();
