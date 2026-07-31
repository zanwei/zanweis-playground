import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const source = (name) => readFile(new URL(name, ROOT), 'utf8');

test('card clicks have a synchronous Web Audio fallback without eager duplicate media', async () => {
  const app = await source('app.js');

  assert.match(app, /function createInstantClickBuffer\(context\)/);
  assert.match(app, /const buffer = clickAudioBuffer \|\| instantClickBuffer/);
  assert.match(app, /source\.buffer = buffer/);
  assert.doesNotMatch(app, /const clickSound = new Audio/);
  assert.doesNotMatch(app, /clickSound\.load\(\)/);
  assert.match(app, /clickSound \|\|= new Audio\(CLICK_SOUND_URL\)/);
});

test('gallery boot batches DOM insertion and serves card-sized images', async () => {
  const [app, html] = await Promise.all([source('app.js'), source('index.html')]);

  assert.match(app, /document\.createDocumentFragment\(\)/);
  assert.match(app, /masonry\.appendChild\(cardFragment\)/);
  assert.match(app, /new IntersectionObserver\(/);
  assert.match(app, /previewHydrationQueue/);
  assert.match(app, /observer\.unobserve\(entry\.target\)/);
  assert.equal(
    [...app.matchAll(/tokenMs\('--duration-stagger'/g)].length,
    1,
    'the stagger token is read once rather than after every card insertion'
  );
  assert.match(app, /cardImageUrl\(item\.thumb\)/);
  assert.match(app, /cardImageUrl\(item\.poster\)/);
  assert.match(app, /fetchpriority="high"/);
  assert.match(app, /decoding="async"/);

  const scripts = [...html.matchAll(/<script src="[^"]+"([^>]*)><\/script>/g)];
  assert.ok(scripts.length >= 8);
  assert.ok(scripts.every(([, attributes]) => /\bdefer\b/.test(attributes)));
});

test('every static card image has a 768px delivery asset', async () => {
  const catalog = await source('catalog.js');
  const originals = [
    ...catalog.matchAll(/(?:image|poster)[:=]\s*[`'"]([^`'"]+\.webp)/g),
  ]
    .map((match) => match[1])
    .filter((path) => !path.includes('${'));

  const expected = [
    'assets/figma/dia-card.webp',
    'assets/figma/linear-card.webp',
    'assets/figma/fontdetector-card.webp',
    'assets/figma/clear-card.webp',
    'assets/figma/macintosh-card.webp',
    'assets/figma/affine-card.webp',
    'assets/dribbble/shoedex-sign-in-card.webp',
    'assets/whiteboard/whiteboard-1-card.webp',
    'assets/whiteboard/whiteboard-2-card.webp',
    'assets/whiteboard/whiteboard-3-card.webp',
    'assets/whiteboard/whiteboard-4-card.webp',
    'assets/video/affine-hero-card.webp',
    'assets/video/bridge-card.webp',
    'assets/video/shoedex-scan-button-card.webp',
  ];

  assert.ok(originals.length > 0);
  await Promise.all(expected.map((path) => access(new URL(path, ROOT))));
});

test('mobile composer avoids transformed visual-viewport caret ancestors', async () => {
  const [social, styles] = await Promise.all([
    source('social.js'),
    source('styles.css'),
  ]);

  assert.match(social, /--composer-viewport-inset-bottom/);
  assert.doesNotMatch(social, /--composer-viewport-bottom/);
  assert.match(
    styles,
    /\.chat-dock\.is-on:focus-within\s*\{[^}]*transform:\s*none/s
  );
  assert.match(styles, /var\(--composer-viewport-inset-bottom,\s*0px\)/);
  assert.doesNotMatch(
    styles,
    /\.chat-dock\.is-visual-viewport\s*\{[^}]*translate:[^}]*-100%/s
  );
});
