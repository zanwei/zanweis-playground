import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

async function source(name) {
  return readFile(new URL(name, ROOT), 'utf8');
}

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `found ${start}`);
  assert.notEqual(to, -1, `found ${end}`);
  return text.slice(from, to);
}

test('Cursor Chat keeps the browser cursor plane and batches its DOM follower', async () => {
  const [social, styles] = await Promise.all([
    source('social.js'),
    source('styles.css'),
  ]);
  const trackPointer = between(
    social,
    'function trackPointer(',
    'function cancelCursorChatSync('
  );
  const syncCursor = between(
    social,
    'function syncCustomCursor(',
    'function ensureCursorChat('
  );

  assert.doesNotMatch(social, /has-dom-cursor|CUSTOM_CURSOR_DOM_ATTR/);
  assert.doesNotMatch(social, /class="site-cursor"/);
  assert.doesNotMatch(styles, /cursor:\s*none\s*!important/);
  assert.match(styles, /\.has-custom-cursor[\s\S]*--site-custom-cursor/);
  assert.match(trackPointer, /scheduleCursorChatRender\(\)/);
  assert.doesNotMatch(trackPointer, /\.style\.transform|positionCursorFollower\(/);
  assert.match(social, /getCoalescedEvents\?\.\(\)/);
  assert.doesNotMatch(syncCursor, /querySelectorAll\(['"]iframe['"]\)/);
});

test('Cursor Chat input measurement performs no synchronous layout read', async () => {
  const social = await source('social.js');
  const measure = between(
    social,
    'function measureCursorChat(',
    'function scheduleCursorChatRender('
  );

  assert.match(measure, /measureText\(/);
  assert.doesNotMatch(measure, /getBoundingClientRect|offsetWidth|clientWidth/);
  assert.doesNotMatch(social, /cursorChatMirror|cursor-chat-mirror/);
  assert.match(social, /spellcheck="false"/);
});

test('only the live playground iframe receives an installed cursor policy', async () => {
  const [social, app] = await Promise.all([
    source('social.js'),
    source('app.js'),
  ]);
  const syncCursor = between(
    social,
    'function syncCustomCursor(',
    'function ensureCursorChat('
  );

  assert.match(syncCursor, /if \(frame\)/);
  assert.match(syncCursor, /installCustomCursorPolicy\(frameDocument\)/);
  assert.equal(
    [...app.matchAll(/Social\.syncCustomCursor\?\.\(frame\)/g)].length,
    2
  );
});

test('Presence defers chat hit-testing and batches remote cursor geometry reads', async () => {
  const presence = await source('presence.js');
  const cursorChat = between(
    presence,
    'cursorChat({ session, seq, text, x, y, ttlMs = CHAT_TTL } = {})',
    'pointerMove(x, y)'
  );
  const frame = between(
    presence,
    'function frame(now)',
    'function ensureLoop()'
  );

  assert.doesNotMatch(cursorChat, /anchorFor\(/);
  assert.match(cursorChat, /pendingLocalChat/);
  assert.match(cursorChat, /schedulePointer\(now, true\)/);
  assert.match(presence, /latestPointerAnchor\.revision === viewportMetrics\.revision/);
  assert.ok(
    frame.indexOf('getBoundingClientRect()') < frame.indexOf('.update('),
    'all anchor reads happen before cursor updates'
  );
  assert.ok(
    frame.indexOf('.update(') < frame.indexOf('.render('),
    'all cursor calculations happen before DOM writes'
  );
  assert.match(presence, /chatPostPending = authenticatedBody\(payload\)/);
  assert.match(presence, /resetChatPosts\(chatPostActive\)/);
});

test('dormant fountain pointer tracking avoids time reads and allocations', async () => {
  const fountain = await source('fountain.js');
  const pointerHandler = between(
    fountain,
    "'pointermove',",
    "{ passive: true }"
  );

  assert.ok(
    pointerHandler.indexOf('if (!held)') < pointerHandler.indexOf('performance.now()')
  );
  assert.doesNotMatch(pointerHandler, /mouse\s*=\s*\{/);
});
