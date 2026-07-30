import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

function bootstrapScript(html) {
  const block = between(
    html,
    '<script>\n      // Buffer real input',
    '</script>'
  );
  return block.slice(block.indexOf('// Buffer real input'));
}

test('Cursor Chat keeps the DOM cursor active while pointer writes stay frame-batched', async () => {
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
  const renderCursor = between(
    social,
    'function renderCursorChat()',
    'function renderCursorChatNow()'
  );
  const cursorDomRequested = between(
    social,
    'function cursorDomRequested()',
    'function cursorDomVisible()'
  );

  assert.match(social, /CUSTOM_CURSOR_DOM_ATTR/);
  assert.match(social, /class="site-cursor"/);
  assert.match(
    social,
    /class="site-cursor"[^>]*>[\s\S]*?<\/div>\s*<div class="cursor-chat-bubble cursor-chat-local-bubble"/,
    'the drawn cursor stays outside the bubble subtree that fades'
  );
  assert.match(styles, /\.has-custom-cursor\.has-dom-cursor[\s\S]*cursor:\s*none/);
  assert.match(styles, /\.has-custom-cursor[\s\S]*--site-custom-cursor/);
  assert.doesNotMatch(
    styles,
    /\.has-custom-cursor[\s\S]{0,180}\*::(?:before|after)/,
    'inherited cursor styles do not invalidate every pseudo-element'
  );
  assert.match(trackPointer, /scheduleCursorChatRender\(\)/);
  assert.doesNotMatch(trackPointer, /\.style\.transform|positionCursorFollower\(/);
  assert.match(renderCursor, /positionCursorFollower\(\)/);
  assert.match(social, /customCursorEditableDocuments/);
  assert.match(
    cursorDomRequested,
    /cursorChatCursorActive/,
    'the DOM cursor stays active for the complete Cursor Chat session'
  );
  assert.doesNotMatch(
    cursorDomRequested,
    /cursorChatFading/,
    'bubble animation state does not control cursor ownership'
  );
  assert.match(social, /addEventListener\(\s*'focusin'/);
  assert.match(social, /addEventListener\(\s*'focusout'/);
  assert.match(social, /getCoalescedEvents\?\.\(\)/);
  assert.doesNotMatch(syncCursor, /querySelectorAll\(['"]iframe['"]\)/);
  assert.match(syncCursor, /const modeChanged =/);
  assert.match(social, /policy\.active === active && policy\.domFollower === domFollower/);
  assert.match(
    styles,
    /\.cursor-chat-local\.is-dom-cursor-active \.site-cursor\s*\{[\s\S]*opacity:\s*1/
  );
  assert.doesNotMatch(
    styles,
    /\.cursor-chat-local\.is-chat-active \.site-cursor/,
    'the native and DOM cursor planes are never visible together for all of chat'
  );
});

test('the first Cursor Chat open reuses a warm layer before focusing', async () => {
  const [social, styles] = await Promise.all([
    source('social.js'),
    source('styles.css'),
  ]);
  const openCursorChat = between(
    social,
    'function openCursorChat(',
    'function isCursorChatOpen('
  );
  const localBubbleStyles = between(
    styles,
    '\n.cursor-chat-local-bubble {',
    '\n.cursor-chat-local.is-chat-active'
  );
  const visibilityIndex = openCursorChat.indexOf(
    'syncCursorChatVisibility()'
  );
  const cursorActiveIndex = openCursorChat.indexOf(
    'cursorChatCursorActive = true'
  );
  const renderIndex = openCursorChat.indexOf('renderCursorChatNow()');
  const customCursorIndex = openCursorChat.indexOf('syncCustomCursor()');
  const focusIndex = openCursorChat.indexOf('cursorChatInput.focus(');

  assert.notEqual(cursorActiveIndex, -1);
  assert.notEqual(visibilityIndex, -1);
  assert.notEqual(renderIndex, -1);
  assert.notEqual(customCursorIndex, -1);
  assert.notEqual(focusIndex, -1);
  assert.ok(
    cursorActiveIndex < visibilityIndex,
    'Cursor Chat takes ownership before the follower becomes visible'
  );
  assert.ok(
    visibilityIndex < renderIndex,
    'the cold follower is visible and promoted before its first transform'
  );
  assert.ok(
    renderIndex < customCursorIndex && customCursorIndex < focusIndex,
    'the DOM cursor is positioned before native input focus can hide the pointer'
  );
  assert.match(
    styles,
    /\.cursor-chat-local\s*\{[\s\S]*opacity:\s*0;[\s\S]*will-change:\s*transform,\s*opacity/
  );
  assert.match(
    styles,
    /\.cursor-chat-local-bubble\s*\{[\s\S]*opacity:\s*0;[\s\S]*will-change:\s*transform,\s*opacity/
  );
  assert.match(
    localBubbleStyles,
    /box-shadow:\s*0 2px 6px rgba\(17, 17, 20, 0\.18\),\s*0 12px 28px rgba\(17, 17, 20, 0\.2\)/
  );
  assert.doesNotMatch(
    social,
    /cursor-chat-bubble cursor-chat-local-bubble" hidden/,
    'the one local bubble stays layout-resident from boot'
  );
});

test('keyboard-first Cursor Chat opens from a deterministic temporary anchor', async () => {
  const [social, app] = await Promise.all([
    source('social.js'),
    source('app.js'),
  ]);
  const openCursorChat = between(
    social,
    'function openCursorChat(',
    'function isCursorChatOpen('
  );
  const closeCursorChat = between(
    social,
    'function closeCursorChatImmediately()',
    'function openCursorChat('
  );
  const trackPointer = between(
    social,
    'function trackPointer(',
    'function cancelCursorChatSync('
  );
  const fallback = between(
    social,
    'function placeCursorChatFallback()',
    'function syncCursorChatMeasureFont()'
  );

  assert.match(openCursorChat, /placeCursorChatFallback\(\)/);
  assert.doesNotMatch(openCursorChat, /cursorChatAwaitingPointer/);
  assert.ok(
    openCursorChat.indexOf('placeCursorChatFallback()') <
      openCursorChat.indexOf('cursorChatSession = createCursorChatSession()'),
    'a cold slash gets an anchor before creating and focusing a composer'
  );
  assert.match(fallback, /width \/ 2/);
  assert.match(fallback, /height \/ 2/);
  assert.match(fallback, /cursorPointValid = true/);
  assert.match(fallback, /cursorPointProvisional = true/);
  assert.match(trackPointer, /activatePendingChat = true/);
  assert.match(trackPointer, /cursorPointProvisional = false/);
  assert.match(closeCursorChat, /cancelPendingCursorChat\(\)/);
  assert.match(social, /matchMedia\('\(any-pointer: fine\)'\)/);
  assert.match(
    app,
    /Social\.trackPointer\?\.\(point\.x, point\.y, false\)/,
    'iframe pointerdown cancels a pending chat instead of opening it'
  );
});

test('cold-start input is captured early and handed to Cursor Chat exactly once', async () => {
  const [html, social] = await Promise.all([
    source('index.html'),
    source('social.js'),
  ]);
  const script = bootstrapScript(html);
  const consume = between(
    social,
    'function consumeCursorChatBootstrap()',
    'function eventTargetsEditable('
  );
  const listeners = new Map();
  const documentListeners = new Map();
  const add = (store, type, listener) => {
    const entries = store.get(type) || [];
    entries.push(listener);
    store.set(type, entries);
  };
  const remove = (store, type, listener) => {
    store.set(
      type,
      (store.get(type) || []).filter((entry) => entry !== listener)
    );
  };
  const window = {};
  let documentFocused = true;
  const document = {
    hasFocus() {
      return documentFocused;
    },
    addEventListener(type, listener) {
      add(documentListeners, type, listener);
    },
    removeEventListener(type, listener) {
      remove(documentListeners, type, listener);
    },
  };
  const timers = new Map();
  let nextTimer = 1;
  const flushTimers = () => {
    for (const [id, callback] of [...timers]) {
      timers.delete(id);
      callback();
    }
  };
  vm.runInNewContext(script, {
    window,
    document,
    Number,
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener(type, listener) {
      add(listeners, type, listener);
    },
    removeEventListener(type, listener) {
      remove(listeners, type, listener);
    },
  });

  const dispatch = (store, type, event) => {
    for (const listener of store.get(type) || []) listener(event);
  };
  const target = {
    nodeType: 1,
    tagName: 'DIV',
    isContentEditable: false,
  };
  dispatch(listeners, 'pointerover', {
    type: 'pointerover',
    pointerType: 'mouse',
    clientX: 321,
    clientY: 187,
    relatedTarget: target,
  });
  let prevented = false;
  dispatch(listeners, 'keydown', {
    key: '/',
    target,
    composedPath: () => [target],
    preventDefault: () => {
      prevented = true;
    },
  });

  assert.deepEqual(
    { ...window.__cursorChatBootstrap.point },
    { x: 321, y: 187 }
  );
  assert.equal(window.__cursorChatBootstrap.slash, true);
  assert.equal(prevented, true);

  dispatch(listeners, 'keydown', {
    key: 'Escape',
    isComposing: true,
    keyCode: 229,
  });
  assert.equal(
    window.__cursorChatBootstrap.slash,
    true,
    'IME-owned Escape does not cancel the buffered slash'
  );

  dispatch(listeners, 'pointerdown', {
    type: 'pointerdown',
    pointerType: 'touch',
    clientX: 9,
    clientY: 11,
  });
  assert.equal(
    window.__cursorChatBootstrap.slash,
    false,
    'all pointerdown types cancel a buffered slash'
  );
  assert.deepEqual(
    { ...window.__cursorChatBootstrap.point },
    { x: 321, y: 187 },
    'touch does not become a desktop Cursor Chat anchor'
  );

  dispatch(listeners, 'keydown', {
    key: '/',
    target,
    composedPath: () => [target],
    preventDefault() {},
  });
  dispatch(documentListeners, 'focusin', {
    target: { nodeType: 1, tagName: 'BUTTON' },
  });
  assert.equal(
    window.__cursorChatBootstrap.slash,
    true,
    'programmatic focus on chrome does not eat a buffered slash'
  );
  dispatch(documentListeners, 'focusin', {
    target: { nodeType: 1, tagName: 'INPUT' },
  });
  assert.equal(
    window.__cursorChatBootstrap.slash,
    false,
    'an editable surface takes ownership of the buffered key'
  );

  dispatch(listeners, 'keydown', {
    key: '/',
    target,
    composedPath: () => [target],
    preventDefault() {},
  });
  dispatch(listeners, 'blur', {});
  flushTimers();
  assert.deepEqual(
    { ...window.__cursorChatBootstrap.point },
    { x: 321, y: 187 },
    'same-document iframe focus does not clear the buffered point'
  );
  assert.equal(
    window.__cursorChatBootstrap.slash,
    true,
    'same-document iframe focus does not clear the buffered shortcut'
  );

  documentFocused = false;
  dispatch(listeners, 'blur', {});
  flushTimers();
  assert.equal(window.__cursorChatBootstrap.point, null);
  assert.equal(window.__cursorChatBootstrap.slash, false);

  window.__cursorChatBootstrap.dispose();
  assert.ok(
    [...listeners.values()].every((entries) => entries.length === 0),
    'window bootstrap listeners are removed during handoff'
  );
  assert.ok(
    [...documentListeners.values()].every((entries) => entries.length === 0),
    'document bootstrap listeners are removed during handoff'
  );

  assert.ok(
    html.indexOf('// Buffer real input') <
      html.indexOf('<link rel="stylesheet" href="styles.css"'),
    'capture starts before the blocking stylesheet'
  );
  assert.ok(
    html.indexOf('// Buffer real input') <
      html.indexOf('<script src="social.js"'),
    'capture starts before Social loads'
  );
  assert.match(consume, /bootstrap\.dispose\?\.\(\)/);
  assert.match(consume, /trackPointer\(point\.x, point\.y, false\)/);
  assert.match(consume, /if \(slashRequested && !documentHasTypingFocus\(document\)\)/);
  assert.ok(
    consume.indexOf('trackPointer(point.x, point.y, false)') <
      consume.indexOf('openCursorChat()'),
    'the exact real point is committed before the saved slash opens chat'
  );
});

test('pending Cursor Chat is cancelled safely and iframe entry supplies a fresh point', async () => {
  const [social, app] = await Promise.all([
    source('social.js'),
    source('app.js'),
  ]);
  const focusIn = between(
    social,
    'function handleTypingCursorFocusIn(',
    'function handleTypingCursorFocusOut('
  );
  const blurHandling = between(
    social,
    'function resetCursorChatForPageExit()',
    "document.addEventListener(\n    'focusin'"
  );
  const pointerWiring = between(
    social,
    "addEventListener(\n    'pointermove'",
    "addEventListener('keydown'"
  );
  const iframePointerWiring = between(
    app,
    'const isFinePointerEvent =',
    'const handleModalTransitionRun ='
  );
  const iframeListeners = between(
    app,
    "listen(\n        frameWindow,\n        'pointerover'",
    "listen(frameWindow, 'pagehide'"
  );
  const iframeKeys = between(
    app,
    'const handleKeyDown =',
    'const handleModalTransitionRun ='
  );

  assert.ok(
    focusIn.indexOf('event.target === cursorChatInput') <
      focusIn.indexOf('eventTargetsTypingInput(event)'),
    'Cursor Chat autofocus bypasses generic typing-cursor synchronization'
  );
  assert.match(blurHandling, /CURSOR_CHAT_BLUR_SETTLE_MS/);
  assert.match(blurHandling, /document\.hasFocus\(\)/);
  assert.match(blurHandling, /requestAnimationFrame\(\(\) =>/);
  assert.match(blurHandling, /cursorChatInput\.focus\(\{ preventScroll: true \}\)/);
  assert.match(social, /addEventListener\('blur', scheduleCursorChatWindowBlur\)/);
  assert.match(social, /addEventListener\('focus', handleCursorChatWindowFocus\)/);
  assert.ok(
    focusIn.indexOf('eventTargetsTypingInput(event)') <
      focusIn.indexOf('cancelPendingCursorChat()'),
    'only an editable focus target cancels a pending shortcut'
  );
  assert.match(pointerWiring, /'pointerover'/);
  assert.match(pointerWiring, /if \(cursorPointValid\) return/);
  assert.match(pointerWiring, /trackPointer\(event\.clientX, event\.clientY\)/);
  assert.match(iframePointerWiring, /isFinePointerEvent\(e\)/);
  assert.match(iframePointerWiring, /const handlePointerArrival/);
  assert.match(iframePointerWiring, /framePointer = null/);
  assert.match(iframeListeners, /'pointerenter'/);
  assert.match(iframeListeners, /'pointerout'/);
  assert.match(
    iframeKeys,
    /requireFreshPointer:\s*true,[\s\S]*pendingOwner:\s*chatPendingOwner/,
    'iframe slash cannot reuse an old top-document point'
  );
  assert.match(iframeKeys, /x:\s*framePointer\.x/);
  assert.match(iframeKeys, /y:\s*framePointer\.y/);
  assert.match(iframeKeys, /pendingOwner:\s*chatPendingOwner/);
  assert.match(
    app,
    /Social\.cancelCursorChatPending\?\.\(chatPendingOwner\)/,
    'a disposed iframe can only cancel the pending intent it owns'
  );
  assert.doesNotMatch(app, /framePointer\.localX|framePointer\.localY/);
  assert.match(
    app,
    /geometry\.valid = true;[\s\S]*framePointer = null;/,
    'geometry changes invalidate the old local point instead of remapping it'
  );
  assert.match(iframeKeys, /e\.isComposing/);
  assert.match(iframeKeys, /e\.keyCode === 229/);
});

test('cold-start chat waits for boot completion before creating a session', async () => {
  const social = await source('social.js');
  const openCursorChat = between(
    social,
    'function openCursorChat(',
    'function isCursorChatOpen('
  );
  const resolvePending = between(
    social,
    'function resolvePendingCursorChat(',
    'function syncCursorChatMeasureFont('
  );
  const eventWiring = between(
    social,
    "addEventListener('keydown'",
    "document.addEventListener('visibilitychange'"
  );

  assert.match(openCursorChat, /cursorChatAwaitingBoot = bootInProgress\(\)/);
  assert.ok(
    openCursorChat.indexOf('if (cursorChatPending())') <
      openCursorChat.indexOf('cursorChatSession = createCursorChatSession()'),
    'boot and pointer prerequisites resolve before session or TTL creation'
  );
  assert.match(resolvePending, /cursorChatAwaitingBoot = bootInProgress\(\)/);
  assert.match(resolvePending, /if \(cursorChatPending\(\)\) return/);
  assert.match(resolvePending, /openCursorChat\(\{ preferRightUntilFit \}\)/);
  assert.match(eventWiring, /'boot:done', schedulePendingCursorChatResolve/);
  assert.match(resolvePending, /requestAnimationFrame\(/);
  assert.ok(
    resolvePending.indexOf('refreshCursorChatLayout()') <
      resolvePending.lastIndexOf('resolvePendingCursorChat()'),
    'the revealed dock is measured in a clean frame before chat opens'
  );
});

test('one-pixel bubble border stays aligned with cached chat geometry', async () => {
  const [social, styles] = await Promise.all([
    source('social.js'),
    source('styles.css'),
  ]);
  const measure = between(
    social,
    'function measureCursorChat(',
    'function scheduleCursorChatRender('
  );
  const observer = between(
    social,
    'if (typeof ResizeObserver',
    "cursorChatInput.addEventListener('compositionstart'"
  );

  assert.match(styles, /border:\s*1px solid var\(--cursor-chat-600\)/);
  assert.match(measure, /cursorChatPendingInputWidth \+ 26/);
  assert.match(measure, /cursorChatHeight = 33/);
  assert.match(observer, /contentWidth \+ 26/);
  assert.match(observer, /contentHeight \+ 14/);
});

test('the chat hint preserves right-side placement until it fits', async () => {
  const social = await source('social.js');
  const positionCursorChat = between(
    social,
    'function positionCursorChat(',
    'function positionCursorFollower('
  );
  const openCursorChat = between(
    social,
    'function openCursorChat(',
    'function isCursorChatOpen('
  );
  const chatHintWiring = between(
    social,
    '// Topbar hint chip:',
    '// Bullet chat is persistent chrome'
  );
  const releaseIndex = positionCursorChat.indexOf(
    'cursorChatPreferRightUntilFit && rightFits'
  );
  const normalFlipIndex = positionCursorChat.indexOf(
    "cursorChatSideX === 'right'"
  );

  assert.notEqual(releaseIndex, -1);
  assert.notEqual(normalFlipIndex, -1);
  assert.ok(
    releaseIndex < normalFlipIndex,
    'the hint placement releases only after right-side space becomes available'
  );
  assert.match(
    positionCursorChat,
    /if \(!cursorChatPreferRightUntilFit\)/
  );
  assert.doesNotMatch(
    positionCursorChat,
    /getBoundingClientRect|offsetWidth|clientWidth/
  );
  assert.match(
    openCursorChat,
    /const preferRightUntilFit = Boolean\(point\?\.preferRightUntilFit\)/
  );
  assert.match(openCursorChat, /cursorChatPreferRightUntilFit = preferRightUntilFit/);
  assert.match(chatHintWiring, /preferRightUntilFit:\s*true/);
  assert.match(social, /const CURSOR_CHAT_HINT_GAP_Y = 28/);
});

test('Cursor Chat waits five seconds, then fades for two seconds even when empty', async () => {
  const [social, presence, styles] = await Promise.all([
    source('social.js'),
    source('presence.js'),
    source('styles.css'),
  ]);
  const openCursorChat = between(
    social,
    'function openCursorChat(',
    'function isCursorChatOpen('
  );
  const inputWiring = between(
    social,
    "cursorChatInput.addEventListener('compositionstart'",
    'function syncCursorChatMeasureFont('
  );
  const scheduleExpiry = between(
    social,
    'function scheduleCursorChatExpiry()',
    'function reviveCursorChat()'
  );
  const reviveCursorChat = between(
    social,
    'function reviveCursorChat()',
    'function finishCursorChat()'
  );
  const releaseChatCursor = between(
    social,
    'function releaseCursorChatCursor()',
    'function reviveCursorChat()'
  );
  const finishCursorChat = between(
    social,
    'function finishCursorChat()',
    'function beginCursorChatFade()'
  );
  const beginCursorChatFade = between(
    social,
    'function beginCursorChatFade()',
    'function closeCursorChat()'
  );
  const remoteSetChat = between(
    presence,
    'setChat({ text, rev, ttlMs, a, fx, fy })',
    'scheduleChatExpiry(remaining)'
  );
  const remoteClearChat = between(
    presence,
    'clearChat(immediate = false)',
    'placeChat('
  );
  const trackPointer = between(
    social,
    'function trackPointer(',
    'function cancelCursorChatSync('
  );
  const focusIndex = openCursorChat.indexOf('cursorChatInput.focus(');
  const expiryIndex = openCursorChat.indexOf('scheduleCursorChatExpiry()');

  assert.notEqual(focusIndex, -1);
  assert.notEqual(expiryIndex, -1);
  assert.ok(
    focusIndex < expiryIndex,
    'an untouched empty composer starts its idle timer after focus'
  );
  assert.match(scheduleExpiry, /CURSOR_CHAT_TTL_MS/);
  assert.match(social, /const CURSOR_CHAT_TTL_MS = 5000/);
  assert.match(
    social,
    /const CURSOR_CHAT_FADE_MS =[\s\S]*?\)\s*\|\|\s*2000;/
  );
  assert.match(
    presence,
    /const CHAT_FADE_MS =[\s\S]*?\)\s*\|\|\s*2000\)\s*\+\s*30;/
  );
  assert.doesNotMatch(scheduleExpiry, /\.value|text|length/);
  assert.equal(
    [...inputWiring.matchAll(/scheduleCursorChatExpiry\(\)/g)].length,
    3,
    'composition commit, ordinary input (including deletion), and Enter all reset expiry'
  );
  assert.doesNotMatch(trackPointer, /scheduleCursorChatExpiry\(\)/);
  assert.match(releaseChatCursor, /cursorChatCursorActive = false/);
  assert.match(releaseChatCursor, /cursorDomHandoffPending = true/);
  assert.match(releaseChatCursor, /cursorDomHandoffReady = false/);
  assert.match(reviveCursorChat, /cursorChatBubble\.classList\.remove\('is-out'\)/);
  assert.match(reviveCursorChat, /cursorChatFading = false/);
  assert.doesNotMatch(reviveCursorChat, /releaseCursorChatCursor\(\)/);
  assert.match(beginCursorChatFade, /cursorChatBubble\.classList\.add\('is-out'\)/);
  assert.match(beginCursorChatFade, /CURSOR_CHAT_FADE_MS/);
  assert.doesNotMatch(
    beginCursorChatFade,
    /syncCursorChatVisibility|renderCursorChatNow|syncCustomCursor/,
    'fading the bubble does not switch cursor planes'
  );
  assert.doesNotMatch(
    beginCursorChatFade,
    /cursorChatOpen\s*=\s*false/,
    'the drawn cursor stays active throughout the bubble fade'
  );
  assert.match(finishCursorChat, /releaseCursorChatCursor\(\)/);
  assert.match(finishCursorChat, /cursorChatOpen\s*=\s*false/);
  assert.ok(
    beginCursorChatFade.indexOf("classList.add('is-out')") <
      beginCursorChatFade.indexOf("sendCursorChatNow('', true)"),
    'clear is sent only after the two-second fade completes'
  );
  assert.match(remoteSetChat, /this\.clearChat\(true\)/);
  assert.match(remoteSetChat, /this\.chatEl\.classList\.remove\('is-out'\)/);
  assert.match(remoteClearChat, /if \(immediate\)/);
  assert.match(remoteClearChat, /this\.chatEl\.classList\.add\('is-out'\)/);
  assert.match(remoteClearChat, /CHAT_FADE_MS/);
  assert.match(styles, /--duration-cursor-chat:\s*2000ms/);
  assert.match(styles, /@keyframes cursor-chat-fade/);
  assert.match(
    styles,
    /\.cursor-chat-bubble\.is-out\s*\{[^}]*animation:\s*cursor-chat-fade var\(--duration-cursor-chat\) linear forwards/
  );
});

test('typing cursor focus tracking covers the top document and live iframe', async () => {
  const social = await source('social.js');
  const typingCursor = between(
    social,
    'function elementUsesTypingCursor(',
    'function ensureCustomCursorDocumentStyle('
  );
  const installPolicy = between(
    social,
    'function installCustomCursorPolicy(',
    'function setCustomCursorPolicyMode('
  );
  const topDocumentWiring = between(
    social,
    'function eventTargetsTypingInput(',
    "addEventListener(\n    'pointermove'"
  );

  assert.match(typingCursor, /node\.isContentEditable/);
  assert.match(typingCursor, /node\.tagName === 'TEXTAREA'/);
  assert.match(typingCursor, /node\.tagName !== 'INPUT'/);
  assert.match(
    typingCursor,
    /if \(active === cursorChatInput\) return false/,
    'Cursor Chat input never enters the generic typing-focus registry'
  );
  assert.match(topDocumentWiring, /document\.addEventListener\(\s*'focusin'/);
  assert.match(topDocumentWiring, /document\.addEventListener\(\s*'focusout'/);
  assert.match(installPolicy, /frameDocument\.addEventListener\('focusin'/);
  assert.match(installPolicy, /frameDocument\.addEventListener\('focusout'/);
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
