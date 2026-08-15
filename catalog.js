/**
 * The component registry. Each entry embeds the repo's own demo page:
 * `viewport` is the fixed design size the preview iframe renders at before
 * being scaled to fit its card; `prime` optionally nudges the demo into a
 * presentable resting state (same-origin, so we can reach into the document).
 */
'use strict';

const CATALOG = [
  {
    slug: 'status-indicator',
    repo: 'status-indicator-web-component',
    title: 'Status Indicator',
    tag: 'status-indicator',
    category: 'status',
    bg: '#ffffff',
    dark: false,
    viewport: [360, 225],
    aspect: '360 / 225',
  },
  {
    slug: 'ball-model-picker',
    repo: 'ball-model-picker',
    title: 'Ball Model Picker',
    tag: 'ball-model-picker',
    category: 'pickers',
    bg: '#0D0F0C',
    dark: true,
    viewport: [560, 620],
    aspect: '560 / 620',
  },
  {
    slug: 'dialog',
    repo: 'dialog-web-component',
    title: 'Delete Confirm Dialog',
    tag: 'delete-confirm-dialog',
    category: 'surfaces',
    bg: '#ffffff',
    dark: false,
    viewport: [520, 340],
    aspect: '520 / 340',
    prime(doc) {
      // The demo-only Reset pill is position:fixed; keep it out of the card.
      const el = doc.querySelector('delete-confirm-dialog');
      el?.removeAttribute('show-reset');
      // Under 464px-tall viewports the demo sets `dialog { overflow: auto }`
      // (scroll room for short screens), which clips the card's shadow. The
      // preview is static and everything fits — keep the shadow visible.
      if (el?.shadowRoot) {
        const fix = doc.createElement('style');
        fix.textContent = 'dialog { overflow: visible !important; }';
        el.shadowRoot.appendChild(fix);
      }
    },
  },
  {
    slug: 'claude-model-selector',
    repo: 'claude-model-selector',
    title: 'Claude Model Selector',
    tag: 'claude-model-selector',
    category: 'pickers',
    bg: '#fdfdfc',
    dark: false,
    viewport: [520, 430],
    aspect: '520 / 430',
  },
  {
    slug: 'liquid-connector',
    repo: 'liquid-connector-web-component',
    title: 'Liquid Connector',
    tag: 'liquid-connector',
    category: 'surfaces',
    bg: '#f2f2f2',
    dark: false,
    viewport: [960, 580],
    aspect: '960 / 580',
    previewCSS: '.controls { display: none !important; }',
  },
  {
    slug: 'model-picker',
    repo: 'model-picker',
    title: 'Model Picker',
    tag: 'model-picker',
    category: 'pickers',
    bg: '#0F0F0F',
    dark: true,
    viewport: [620, 500],
    aspect: '620 / 500',
    prime(doc) {
      doc.querySelector('model-picker')?.setAttribute('open', '');
    },
  },
  {
    slug: 'table-of-content',
    repo: 'table-of-content-component',
    title: 'Table of Contents',
    tag: 'table-of-content',
    category: 'navigation',
    bg: '#ffffff',
    dark: false,
    viewport: [640, 640],
    aspect: '640 / 640',
    prime(doc) {
      doc.querySelector('table-of-content')?.setAttribute('open', '');
    },
  },
  {
    slug: 'connected-filmstrip',
    repo: 'connected-filmstrip',
    title: 'Connected Filmstrip',
    category: 'surfaces',
    bg: '#111113',
    dark: true,
    viewport: [960, 600],
    aspect: '960 / 600',
  },
  {
    slug: 'chatgpt-model-selector',
    repo: 'chatgpt-model-selector',
    title: 'ChatGPT Model Selector',
    tag: 'chatgpt-model-selector',
    category: 'pickers',
    bg: '#ffffff',
    dark: false,
    viewport: [520, 400],
    aspect: '520 / 400',
    prime(doc) {
      // No `open` attribute — click the trigger pill through the shadow root.
      const el = doc.querySelector('chatgpt-model-selector');
      el?.shadowRoot?.querySelector('.pill')?.click();
    },
  },
];

for (const item of CATALOG) {
  // Directory-canonical URL: Workers Assets 307-redirects ".../index.html"
  // to ".../", which broke the modal's loaded-document check and cost every
  // preview an extra round trip. The directory form loads redirect-free on
  // both the Worker and `node server.js`.
  item.demo = `components/${item.repo}/`;
  item.github = `https://github.com/zanwei/${item.repo}`;
}

// Figma logo explorations. Both the card and playground use a vendored static
// image; Source remains the way into the original Figma file.
const FIGMA_FILES = [
  {
    slug: 'dia-logo',
    title: 'Dia Logo',
    key: 'b6dp7Bk4Nc40b223KTStZ0',
    file: 'Dia-logo--Community-',
    bg: '#f8fcff',
  },
  {
    slug: 'linear-logo',
    title: 'Linear Logo',
    key: 'FaC6zeEtEwaLWn2JXpVgYK',
    file: 'Linear--Community-',
    bg: '#000000',
  },
  {
    slug: 'fontdetector-logo',
    title: 'FontDetector Logo',
    key: 'lx9dzGhWQf7UrNUln8qZ4G',
    file: 'FontDetector-Logo--Community-',
    bg: '#f7f7f7',
  },
  {
    slug: 'clear-logo',
    title: 'Clear App Logo',
    key: '2H97LwDRKcrkL4Zf605ufj',
    file: 'Clear-App-Logo--Community-',
    bg: 'linear-gradient(#191b2a 0 32.7%, #010202 67.3% 100%)',
  },
  {
    slug: 'macintosh-logo',
    title: 'Macintosh Logo',
    source: 'https://www.figma.com/community/file/1465519339897723342',
    bg: '#f8f6ea',
  },
  {
    slug: 'affine-logo',
    title: 'AFFiNE Logo',
    source: 'https://www.figma.com/community/file/1260248555835307433',
    bg: '#0c1023',
  },
];

for (const f of FIGMA_FILES) {
  const image = `assets/figma/${f.slug.replace('-logo', '')}.webp`;
  CATALOG.push({
    slug: f.slug,
    title: f.title,
    type: 'figma',
    image,
    thumb: image,
    github: f.source || `https://www.figma.com/design/${f.key}/${f.file}`,
    bg: f.bg,
    aspect: '4 / 3',
  });
}

// Editorial stills share the same lightweight image treatment as the Figma
// studies, but keep their original product or showcase page as Source.
const IMAGE_FILES = [
  {
    slug: 'shoedex-sign-in',
    title: 'ShoeDex Sign in',
    image: 'assets/dribbble/shoedex-sign-in.webp',
    source: 'https://dribbble.com/shots/26484560-ShoeDex-Sign-in',
    bg: '#ffffff',
    aspect: '2048 / 1415',
  },
  {
    slug: 'whiteboard-1',
    title: 'Whiteboard 1',
    image: 'assets/whiteboard/whiteboard-1.webp',
    source: 'https://affine.pro/whiteboard',
    bg: '#ffffff',
    aspect: '2048 / 1335',
  },
  {
    slug: 'whiteboard-2',
    title: 'Whiteboard 2',
    image: 'assets/whiteboard/whiteboard-2.webp',
    source: 'https://affine.pro/whiteboard',
    bg: '#ffffff',
    aspect: '2048 / 1335',
  },
  {
    slug: 'whiteboard-3',
    title: 'Whiteboard 3',
    image: 'assets/whiteboard/whiteboard-3.webp',
    source: 'https://affine.pro/whiteboard',
    bg: '#ffffff',
    aspect: '2048 / 1206',
  },
  {
    slug: 'whiteboard-4',
    title: 'Whiteboard 4',
    image: 'assets/whiteboard/whiteboard-4.webp',
    source: 'https://affine.pro/whiteboard',
    bg: '#ffffff',
    aspect: '2048 / 1335',
  },
];

for (const item of IMAGE_FILES) {
  CATALOG.push({
    slug: item.slug,
    title: item.title,
    type: 'image',
    image: item.image,
    thumb: item.image,
    github: item.source,
    bg: item.bg,
    aspect: item.aspect,
  });
}

// Motion studies use a poster at rest and a muted WebM while the card is
// hovered. Source points to the product rather than a repository.
const VIDEO_FILES = [
  {
    slug: 'affine-hero',
    title: 'AFFiNE Hero',
    source: 'https://affine.pro',
    bg: '#ffffff',
    aspect: '36 / 25',
  },
  {
    slug: 'bridge',
    title: 'Bridge',
    source: 'https://bridge.surf',
    bg: '#ffffff',
    aspect: '960 / 541',
  },
  {
    slug: 'shoedex-scan-button',
    title: 'ShoeDex Scan Button',
    source: 'https://dribbble.com/shots/26485309-ShoeDex-3D-Capture-Btn',
    bg: '#ffffff',
    aspect: '4 / 3',
  },
];

for (const item of VIDEO_FILES) {
  const previewVideo = `assets/video/${item.slug}-card-v1.webm`;
  const video = `assets/video/${item.slug}-full-v1.webm`;
  const poster = `assets/video/${item.slug}.webp`;
  CATALOG.push({
    slug: item.slug,
    title: item.title,
    type: 'video',
    previewVideo,
    video,
    poster,
    image: poster,
    thumb: poster,
    github: item.source,
    bg: item.bg,
    aspect: item.aspect,
  });
}

// One-off editorial shuffle. This order is intentionally fixed: reloading
// the page must not make cards jump to different positions.
const DISPLAY_ORDER = [
  'connected-filmstrip',
  'fontdetector-logo',
  'shoedex-sign-in',
  'ball-model-picker',
  'macintosh-logo',
  'linear-logo',
  'whiteboard-1',
  'table-of-content',
  'liquid-connector',
  'affine-logo',
  'shoedex-scan-button',
  'chatgpt-model-selector',
  'bridge',
  'whiteboard-2',
  'dialog',
  'clear-logo',
  'claude-model-selector',
  'whiteboard-3',
  'affine-hero',
  'status-indicator',
  'model-picker',
  'whiteboard-4',
  'dia-logo',
];
const DISPLAY_RANK = new Map(DISPLAY_ORDER.map((slug, index) => [slug, index]));
CATALOG.sort(
  (a, b) =>
    (DISPLAY_RANK.get(a.slug) ?? Number.MAX_SAFE_INTEGER) -
    (DISPLAY_RANK.get(b.slug) ?? Number.MAX_SAFE_INTEGER)
);
