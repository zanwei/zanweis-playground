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
        if (barOpen) focusComposerInput();
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
      if (barOpen) focusComposerInput();
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

  function syncBarTrigger() {
    if (!chatHint) return;
    chatHint.setAttribute('aria-expanded', String(barOpen));
    chatHint.title = barOpen ? 'Close Bullet screen' : 'Open Bullet screen';
  }

  function ensureBar() {
    if (barEl) return;
    barEl = document.createElement('div');
    barEl.id = 'chat-dock';
    barEl.className = 'chat-dock';
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
        closeBar();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        doSend();
      }
    });
    barSend.addEventListener('click', doSend);
    document.addEventListener('pointerdown', (e) => {
      if (!barOpen) return;
      // Dismissing a bullet is part of the chat surface — only a click on the
      // page itself closes the composer.
      if (
        barEl.contains(e.target) ||
        chatHint?.contains(e.target) ||
        e.target.closest('.bullet')
      ) {
        return;
      }
      closeBar();
    });
  }

  function openBar(instant = false, focus = true) {
    ensureBar();
    barOpen = true;
    barEl.hidden = false;
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
    syncBarTrigger();
  }

  function closeBar(instant = false) {
    if (!barOpen) return;
    barOpen = false;
    barInput.value = '';
    barSend.disabled = true;
    if (document.activeElement === barInput) barInput.blur();
    if (instant) barEl.classList.add('is-instant');
    barEl.classList.remove('is-on');
    if (instant) {
      barEl.hidden = true;
      barEl.classList.remove('is-instant');
      clearComposerViewportTimers();
      resetComposerViewportPosition();
      syncBarTrigger();
      return;
    }
    syncBarTrigger();
    setTimeout(() => {
      if (!barOpen) {
        barEl.hidden = true;
        clearComposerViewportTimers();
        resetComposerViewportPosition();
      }
    }, 200);
  }

  function toggleBar(instant = false) {
    if (barOpen) closeBar(instant);
    else openBar(instant);
  }

  addEventListener('keydown', (e) => {
    if (e.key !== '/') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleBar(true);
  });

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

  // Topbar hint chip: another way in, for people who never guess "/".
  chatHint?.addEventListener('click', () => toggleBar());
  openBar(true, false);

  // --- wiring ---------------------------------------------------------------

  return {
    location: sharedLocation,
    bind(p) {
      presence = p;
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
  };
})();
