import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

class SseClient {
  constructor(response, controller) {
    this.controller = controller;
    this.messages = [];
    this.waiters = [];
    this.decoder = new TextDecoder();
    this.buffer = '';
    this.pump(response.body.getReader());
  }

  async pump(reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = this.buffer.indexOf('\n\n')) !== -1) {
          const block = this.buffer.slice(0, boundary);
          this.buffer = this.buffer.slice(boundary + 2);
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (data) this.emit(JSON.parse(data));
        }
      }
    } catch (error) {
      if (error?.name !== 'AbortError') this.rejectAll(error);
    }
  }

  emit(message) {
    const waiterIndex = this.waiters.findIndex(({ predicate }) => predicate(message));
    if (waiterIndex === -1) {
      this.messages.push(message);
      return;
    }
    const [waiter] = this.waiters.splice(waiterIndex, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }

  rejectAll(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  next(predicate = () => true, timeoutMs = 1500) {
    const messageIndex = this.messages.findIndex(predicate);
    if (messageIndex !== -1) {
      return Promise.resolve(this.messages.splice(messageIndex, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        const error = new Error('SSE assertion timed out');
        error.code = 'SSE_TIMEOUT';
        reject(error);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async expectNone(predicate, timeoutMs = 180) {
    try {
      const message = await this.next(predicate, timeoutMs);
      assert.fail(`unexpected SSE message: ${JSON.stringify(message)}`);
    } catch (error) {
      if (error?.code !== 'SSE_TIMEOUT') throw error;
    }
  }

  close() {
    this.controller.abort();
  }
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function startLocalPresence(t) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('local server did not start')), 2000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`local server exited early (${code})`));
    });
    child.stdout.once('data', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return `http://127.0.0.1:${port}`;
}

async function openSse(baseUrl, clientId) {
  const controller = new AbortController();
  const response = await fetch(
    `${baseUrl}/presence/stream?client=${encodeURIComponent(clientId)}`,
    { signal: controller.signal }
  );
  assert.equal(response.status, 200);
  return new SseClient(response, controller);
}

async function postPresence(baseUrl, hello, message) {
  const response = await fetch(`${baseUrl}/presence/event`, {
    method: 'POST',
    body: JSON.stringify({ id: hello.id, token: hello.token, ...message }),
  });
  assert.equal(response.status, 204);
}

function chatEntries(message) {
  if (message?.t === 'chat') return [message];
  if (message?.t === 'chats' && Array.isArray(message.list)) return message.list;
  return [];
}

async function nextSseChat(client, predicate = () => true, timeoutMs = 1500) {
  const message = await client.next(
    (candidate) => chatEntries(candidate).some(predicate),
    timeoutMs
  );
  return chatEntries(message).find(predicate);
}

async function expectNoSseChat(client, predicate = () => true, timeoutMs = 180) {
  await client.expectNone(
    (candidate) => chatEntries(candidate).some(predicate),
    timeoutMs
  );
}

function peerChat(hello, id) {
  return hello?.peers?.find((peer) => peer.id === id)?.chat || null;
}

function sentChats(socket, predicate = () => true) {
  return socket.sent.flatMap(chatEntries).filter(predicate);
}

function cursorEntries(message) {
  if (message?.t === 'cursor') return [message];
  if (message?.t === 'cursors' && Array.isArray(message.list)) return message.list;
  return [];
}

function sentCursors(socket, predicate = () => true) {
  return socket.sent.flatMap(cursorEntries).filter(predicate);
}

test('SSE keeps private identities secret and aggregates connection state', async (t) => {
  const baseUrl = await startLocalPresence(t);
  const observerClientId = 'observer_private_0001';
  const victimClientId = 'victim_private_00001';
  const inspectorClientId = 'inspector_private_001';

  const observer = await openSse(baseUrl, observerClientId);
  t.after(() => observer.close());
  const observerHello = await observer.next((m) => m.t === 'hello');
  const observerId = observerHello.id;
  assert.notEqual(observerId, observerClientId);
  assert.equal(Object.hasOwn(observerHello, 'clientId'), false);
  assert.equal(JSON.stringify(observerHello).includes(observerClientId), false);
  await observer.next((m) => m.t === 'count' && m.n === 1);

  const oldConnection = await openSse(baseUrl, victimClientId);
  t.after(() => oldConnection.close());
  const oldHello = await oldConnection.next((m) => m.t === 'hello');
  const victimId = oldHello.id;
  assert.notEqual(victimId, victimClientId);
  assert.equal(Object.hasOwn(oldHello, 'clientId'), false);
  assert.equal(JSON.stringify(oldHello).includes(victimClientId), false);
  assert.deepEqual(oldHello.peers.map((peer) => peer.id), [observerId]);
  await observer.next((m) => m.t === 'join' && m.id === victimId);
  await observer.next((m) => m.t === 'count' && m.n === 2);

  const replacement = await openSse(baseUrl, victimClientId);
  t.after(() => replacement.close());
  const replacementHello = await replacement.next((m) => m.t === 'hello');
  assert.equal(replacementHello.id, victimId);
  assert.equal(Object.hasOwn(replacementHello, 'clientId'), false);
  assert.deepEqual(replacementHello.peers.map((peer) => peer.id), [observerId]);
  await replacement.next((m) => m.t === 'count' && m.n === 2);
  await observer.expectNone(
    (m) => (m.t === 'join' && m.id === victimId) || (m.t === 'count' && m.n !== 2)
  );

  // A public id observed in the room is not an authentication credential.
  // Supplying it as ?client= creates an unrelated private identity with a new
  // public id instead of impersonating the victim.
  const impersonator = await openSse(baseUrl, victimId);
  t.after(() => impersonator.close());
  const impersonatorHello = await impersonator.next((m) => m.t === 'hello');
  assert.notEqual(impersonatorHello.id, victimId);
  assert.equal(Object.hasOwn(impersonatorHello, 'clientId'), false);
  assert.deepEqual(
    new Set(impersonatorHello.peers.map((peer) => peer.id)),
    new Set([observerId, victimId])
  );
  await observer.next((m) => m.t === 'join' && m.id === impersonatorHello.id);
  await observer.next((m) => m.t === 'count' && m.n === 3);
  impersonator.close();
  await observer.next((m) => m.t === 'leave' && m.id === impersonatorHello.id);
  await observer.next((m) => m.t === 'count' && m.n === 2);

  // Both connections become active. An idle from the old page must not retract
  // the replacement connection's newer cursor.
  await postPresence(baseUrl, oldHello, {
    t: 'cursor',
    a: 'page',
    fx: 0.1,
    fy: 60,
  });
  await observer.next((m) => m.t === 'cursor' && m.id === victimId && m.fx === 0.1);
  await postPresence(baseUrl, replacementHello, {
    t: 'cursor',
    a: 'page',
    fx: 0.25,
    fy: 120,
  });
  assert.deepEqual(
    await observer.next((m) => m.t === 'cursor' && m.id === victimId && m.fx === 0.25),
    {
      t: 'cursor',
      id: victimId,
      a: 'page',
      fx: 0.25,
      fy: 120,
      color: replacementHello.color,
    }
  );
  await postPresence(baseUrl, oldHello, { t: 'idle' });
  await observer.expectNone((m) => m.t === 'idle' && m.id === victimId, 220);

  // Focus is also per connection: clearing the old tab leaves the replacement
  // tab's focus intact, then clearing the replacement emits the aggregate clear.
  await postPresence(baseUrl, oldHello, { t: 'focus', card: 'dialog' });
  await observer.next((m) => m.t === 'focus' && m.id === victimId && m.card === 'dialog');
  await postPresence(baseUrl, replacementHello, {
    t: 'focus',
    card: 'model-picker',
  });
  await observer.next(
    (m) => m.t === 'focus' && m.id === victimId && m.card === 'model-picker'
  );
  await postPresence(baseUrl, oldHello, { t: 'focus', card: null });
  await observer.expectNone(
    (m) => m.t === 'focus' && m.id === victimId && m.card !== 'model-picker',
    180
  );
  await postPresence(baseUrl, replacementHello, { t: 'focus', card: null });
  await observer.next((m) => m.t === 'focus' && m.id === victimId && !m.card);

  await postPresence(baseUrl, replacementHello, { t: 'bullet', text: 'hello' });
  assert.equal(
    (await observer.next((m) => m.t === 'bullet' && m.id === victimId)).text,
    'hello'
  );
  await postPresence(baseUrl, replacementHello, { t: 'loc', loc: { country: 'SG' } });
  assert.deepEqual(
    (await observer.next((m) => m.t === 'loc' && m.id === victimId)).loc,
    { country: 'SG' }
  );
  await oldConnection.expectNone(
    (m) =>
      m.id === victimId &&
      (m.t === 'cursor' || m.t === 'bullet' || m.t === 'loc')
  );

  const inspector = await openSse(baseUrl, inspectorClientId);
  t.after(() => inspector.close());
  const inspectorHello = await inspector.next((m) => m.t === 'hello');
  assert.deepEqual(
    new Set(inspectorHello.peers.map((peer) => peer.id)),
    new Set([observerId, victimId])
  );
  assert.equal(inspectorHello.peers.length, 2);
  assert.equal(JSON.stringify(inspectorHello).includes(victimClientId), false);

  oldConnection.close();
  await observer.expectNone((m) => m.t === 'leave' && m.id === victimId, 250);

  replacement.close();
  await observer.next((m) => m.t === 'leave' && m.id === victimId);
  await observer.expectNone((m) => m.t === 'leave' && m.id === victimId, 180);
});

test('SSE chat is live state with validation, snapshots, and owner-safe cleanup', async (t) => {
  const baseUrl = await startLocalPresence(t);
  const observerClientId = 'chat_observer_private_0001';
  const chatterClientId = 'chat_chatter_private_00001';

  const observer = await openSse(baseUrl, observerClientId);
  t.after(() => observer.close());
  await observer.next((message) => message.t === 'hello');
  await observer.next((message) => message.t === 'count' && message.n === 1);

  const oldConnection = await openSse(baseUrl, chatterClientId);
  t.after(() => oldConnection.close());
  const oldHello = await oldConnection.next((message) => message.t === 'hello');
  const chatterId = oldHello.id;
  await observer.next((message) => message.t === 'join' && message.id === chatterId);
  await observer.next((message) => message.t === 'count' && message.n === 2);

  const replacement = await openSse(baseUrl, chatterClientId);
  t.after(() => replacement.close());
  const replacementHello = await replacement.next((message) => message.t === 'hello');
  assert.equal(replacementHello.id, chatterId);
  await replacement.next((message) => message.t === 'count' && message.n === 2);
  await observer.expectNone(
    (message) =>
      (message.t === 'join' && message.id === chatterId) ||
      (message.t === 'count' && message.n !== 2)
  );

  const oldSession = 'chat_old_session_0001';
  const firstText = '你好, hello 🙂';
  await postPresence(baseUrl, oldHello, {
    t: 'chat',
    session: oldSession,
    seq: 1,
    text: firstText,
    a: 'page',
    fx: 0.25,
    fy: 120,
    ttlMs: 5000,
  });
  const firstChat = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === firstText
  );
  assert.deepEqual(
    {
      t: firstChat.t || 'chat',
      id: firstChat.id,
      color: firstChat.color,
      text: firstChat.text,
      a: firstChat.a,
      fx: firstChat.fx,
      fy: firstChat.fy,
    },
    {
      t: 'chat',
      id: chatterId,
      color: oldHello.color,
      text: firstText,
      a: 'page',
      fx: 0.25,
      fy: 120,
    }
  );
  assert.equal(Number.isSafeInteger(firstChat.rev), true);
  assert.equal(firstChat.ttlMs > 0 && firstChat.ttlMs <= 5000, true);
  assert.equal(JSON.stringify(firstChat).includes(chatterClientId), false);

  const rejectedText = 'must not be broadcast';
  const invalidMessages = [
    {
      session: 'short',
      seq: 2,
      text: rejectedText,
      a: 'page',
      fx: 0.2,
      fy: 20,
      ttlMs: 5000,
    },
    {
      session: oldSession,
      seq: 0,
      text: rejectedText,
      a: 'page',
      fx: 0.2,
      fy: 20,
      ttlMs: 5000,
    },
    {
      session: oldSession,
      seq: 1.5,
      text: rejectedText,
      a: 'page',
      fx: 0.2,
      fy: 20,
      ttlMs: 5000,
    },
    {
      session: oldSession,
      seq: 2,
      text: rejectedText,
      a: 'not/an-anchor',
      fx: 0.2,
      fy: 20,
      ttlMs: 5000,
    },
    {
      session: oldSession,
      seq: 2,
      text: rejectedText,
      a: 'page',
      fx: null,
      fy: 20,
      ttlMs: 5000,
    },
    {
      session: oldSession,
      seq: 2,
      text: rejectedText,
      a: 'card:dialog',
      fx: 0.2,
      fy: '0.5',
      ttlMs: 5000,
    },
    {
      session: oldSession,
      seq: 2,
      text: rejectedText,
      a: 'page',
      fx: 0.2,
      fy: 20,
      ttlMs: null,
    },
  ];
  for (const invalid of invalidMessages) {
    await postPresence(baseUrl, oldHello, { t: 'chat', ...invalid });
  }
  await expectNoSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === rejectedText,
    220
  );

  await postPresence(baseUrl, oldHello, {
    t: 'chat',
    session: oldSession,
    seq: 2,
    text: 'sequence two',
    a: 'card:dialog',
    fx: -2,
    fy: 42,
    ttlMs: 5000.9,
  });
  const sequenceTwo = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === 'sequence two'
  );
  assert.equal(sequenceTwo.ttlMs > 0 && sequenceTwo.ttlMs <= 5000, true);

  await postPresence(baseUrl, oldHello, {
    t: 'chat',
    session: oldSession,
    seq: 1,
    text: 'out of order',
    a: 'page',
    fx: 0.1,
    fy: 10,
    ttlMs: 5000,
  });
  await expectNoSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === 'out of order'
  );

  const rawUnicodeText =
    `中文 mixed English 🙂\u0000\u001f\u007f<img onerror=alert(1)>` +
    '🚀'.repeat(140);
  const expectedUnicodeText = Array.from(
    rawUnicodeText.replace(/[\u0000-\u001f\u007f]/g, '')
  )
    .slice(0, 120)
    .join('');
  await postPresence(baseUrl, oldHello, {
    t: 'chat',
    session: oldSession,
    seq: 3,
    text: rawUnicodeText,
    a: 'shell:brand',
    fx: 0.8,
    fy: 0.4,
    ttlMs: 5000,
  });
  const unicodeChat = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === expectedUnicodeText
  );
  assert.equal(unicodeChat.text, expectedUnicodeText);
  assert.equal(Array.from(unicodeChat.text).length, 120);
  assert.equal(unicodeChat.text.includes('<img onerror=alert(1)>'), true);
  assert.equal(/[\u0000-\u001f\u007f]/.test(unicodeChat.text), false);

  // Live chat updates use their own state channel and must not spend the
  // sender's three-token bullet burst.
  for (let seq = 4; seq <= 9; seq++) {
    await postPresence(baseUrl, oldHello, {
      t: 'chat',
      session: oldSession,
      seq,
      text: `chat update ${seq}`,
      a: 'page',
      fx: 0.3,
      fy: 100 + seq,
      ttlMs: 5000,
    });
  }
  for (const text of ['bullet one', 'bullet two', 'bullet three']) {
    await postPresence(baseUrl, oldHello, { t: 'bullet', text });
    assert.equal(
      (await observer.next(
        (message) =>
          message.t === 'bullet' &&
          message.id === chatterId &&
          message.text === text
      )).text,
      text
    );
  }

  // A newer session on a sibling connection owns the stable user's public
  // chat. The old connection can neither clear it nor retract it by idling.
  const replacementSession = 'chat_new_session_0001';
  await postPresence(baseUrl, replacementHello, {
    t: 'chat',
    session: replacementSession,
    seq: 1,
    text: 'replacement owns this',
    a: 'page',
    fx: 0.65,
    fy: 240,
    ttlMs: 5000,
  });
  const replacementChat = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === 'replacement owns this'
  );
  assert.equal(replacementChat.rev > unicodeChat.rev, true);

  await postPresence(baseUrl, oldHello, {
    t: 'chat',
    session: oldSession,
    seq: 10,
    text: 'superseded session must stay stale',
    a: 'page',
    fx: 0.3,
    fy: 110,
    ttlMs: 5000,
  });
  await expectNoSseChat(
    observer,
    (chat) =>
      chat.id === chatterId &&
      chat.text === 'superseded session must stay stale'
  );

  await postPresence(baseUrl, oldHello, {
    t: 'chat',
    session: oldSession,
    seq: 11,
    text: '',
    a: 'page',
    fx: 0.3,
    fy: 110,
    ttlMs: 5000,
  });
  await postPresence(baseUrl, oldHello, { t: 'idle' });
  await expectNoSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === '',
    220
  );

  const activeInspector = await openSse(baseUrl, 'chat_active_inspector_0001');
  t.after(() => activeInspector.close());
  const activeHello = await activeInspector.next((message) => message.t === 'hello');
  const activeSnapshot = peerChat(activeHello, chatterId);
  assert.equal(activeSnapshot?.text, 'replacement owns this');
  assert.equal(activeSnapshot?.rev, replacementChat.rev);
  assert.equal(activeSnapshot?.ttlMs > 0 && activeSnapshot.ttlMs <= 5000, true);
  assert.equal(JSON.stringify(activeHello).includes(chatterClientId), false);

  // Supersession is session-scoped, not connection-scoped. A brand-new
  // session on the old connection may take ownership again, after which the
  // replacement likewise needs a fresh session to regain it.
  const oldReturnSession = 'chat_old_return_session_01';
  await postPresence(baseUrl, oldHello, {
    t: 'chat',
    session: oldReturnSession,
    seq: 1,
    text: 'old connection returns with new session',
    a: 'page',
    fx: 0.35,
    fy: 180,
    ttlMs: 5000,
  });
  const oldReturnChat = await nextSseChat(
    observer,
    (chat) =>
      chat.id === chatterId &&
      chat.text === 'old connection returns with new session'
  );
  assert.equal(oldReturnChat.rev > replacementChat.rev, true);

  const replacementReturnSession = 'chat_replacement_return_01';
  await postPresence(baseUrl, replacementHello, {
    t: 'chat',
    session: replacementReturnSession,
    seq: 1,
    text: 'replacement returns with new session',
    a: 'page',
    fx: 0.7,
    fy: 241,
    ttlMs: 5000,
  });
  const replacementReturnChat = await nextSseChat(
    observer,
    (chat) =>
      chat.id === chatterId &&
      chat.text === 'replacement returns with new session'
  );
  assert.equal(replacementReturnChat.rev > oldReturnChat.rev, true);

  // A clear must pass immediately even after a same-connection update burst.
  for (let seq = 2; seq <= 12; seq++) {
    await postPresence(baseUrl, replacementHello, {
      t: 'chat',
      session: replacementReturnSession,
      seq,
      text: `replacement update ${seq}`,
      a: 'page',
      fx: 0.7,
      fy: 240 + seq,
      ttlMs: 5000,
    });
  }
  await postPresence(baseUrl, replacementHello, {
    t: 'chat',
    session: replacementReturnSession,
    seq: 13,
    text: '',
    a: 'page',
    fx: 0.7,
    fy: 253,
    ttlMs: 5000,
  });
  const explicitClear = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === ''
  );
  assert.equal(explicitClear.rev > replacementReturnChat.rev, true);
  assert.equal(explicitClear.ttlMs, 0);

  const clearedInspector = await openSse(baseUrl, 'chat_cleared_inspector_0001');
  t.after(() => clearedInspector.close());
  const clearedHello = await clearedInspector.next((message) => message.t === 'hello');
  assert.equal(peerChat(clearedHello, chatterId), null);

  // Hello carries only the remaining lifetime. Once the server-side deadline
  // has elapsed, a late joiner must not receive stale typing state.
  const expiringSession = 'chat_expiring_session_01';
  await postPresence(baseUrl, replacementHello, {
    t: 'chat',
    session: expiringSession,
    seq: 1,
    text: 'short lived',
    a: 'page',
    fx: 0.4,
    fy: 300,
    ttlMs: 300,
  });
  const expiringChat = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === 'short lived'
  );
  assert.equal(expiringChat.ttlMs > 0 && expiringChat.ttlMs <= 300, true);

  const beforeExpiry = await openSse(baseUrl, 'chat_before_expiry_0001');
  t.after(() => beforeExpiry.close());
  const beforeExpiryHello = await beforeExpiry.next((message) => message.t === 'hello');
  assert.equal(peerChat(beforeExpiryHello, chatterId)?.text, 'short lived');

  await new Promise((resolve) => setTimeout(resolve, 360));
  const afterExpiry = await openSse(baseUrl, 'chat_after_expiry_00001');
  t.after(() => afterExpiry.close());
  const afterExpiryHello = await afterExpiry.next((message) => message.t === 'hello');
  assert.equal(peerChat(afterExpiryHello, chatterId), null);

  const idleSession = 'chat_idle_session_00001';
  await postPresence(baseUrl, replacementHello, {
    t: 'chat',
    session: idleSession,
    seq: 1,
    text: 'clear me on idle',
    a: 'page',
    fx: 0.5,
    fy: 320,
    ttlMs: 5000,
  });
  await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === 'clear me on idle'
  );
  await postPresence(baseUrl, replacementHello, { t: 'idle' });
  const idleClear = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === ''
  );
  assert.equal(idleClear.ttlMs, 0);

  const finalSession = 'chat_final_session_0001';
  await postPresence(baseUrl, replacementHello, {
    t: 'chat',
    session: finalSession,
    seq: 1,
    text: 'clear me on final disconnect',
    a: 'page',
    fx: 0.55,
    fy: 340,
    ttlMs: 5000,
  });
  await nextSseChat(
    observer,
    (chat) =>
      chat.id === chatterId && chat.text === 'clear me on final disconnect'
  );

  oldConnection.close();
  await expectNoSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === '',
    220
  );
  replacement.close();
  const disconnectClear = await nextSseChat(
    observer,
    (chat) => chat.id === chatterId && chat.text === ''
  );
  assert.equal(disconnectClear.ttlMs, 0);
  await observer.next((message) => message.t === 'leave' && message.id === chatterId);
});

class FakeSocket {
  constructor(clientId, userId, options = {}) {
    const connection = options.connection || {};
    this.attachment = {
      clientId,
      userId,
      stateSeq: options.stateSeq || 0,
      loc: options.loc ?? null,
      lastEvent: Object.hasOwn(options, 'lastEvent')
        ? options.lastEvent
        : connection.lastEvent || null,
      idle: Object.hasOwn(options, 'idle') ? options.idle : connection.idle !== false,
      focus: Object.hasOwn(options, 'focus')
        ? options.focus
        : connection.focus || null,
      spray: Object.hasOwn(options, 'spray') ? options.spray : !!connection.spray,
      connection,
    };
    this.sent = [];
    this.closeCount = 0;
    this.serializeCount = 0;
    this.serializeFailures = 0;
  }

  deserializeAttachment() {
    return this.attachment;
  }

  serializeAttachment(value) {
    this.serializeCount++;
    if (this.serializeFailures > 0) {
      this.serializeFailures--;
      throw new Error('simulated attachment serialization failure');
    }
    this.attachment = structuredClone(value);
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }

  close() {
    this.closeCount++;
  }
}

function durableState(sockets) {
  const values = new Map();
  const storage = {
    async get(key) {
      return values.get(key);
    },
    async list() {
      return new Map();
    },
    async transaction(callback) {
      return callback(this);
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
  };
  return {
    storage,
    blockConcurrencyWhile(callback) {
      return callback();
    },
    getWebSockets() {
      return sockets;
    },
  };
}

async function importPresenceRoom() {
  const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  const testableSource = source.replace(
    "import { WorkerEntrypoint } from 'cloudflare:workers';",
    'class WorkerEntrypoint {}'
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`;
  const { PresenceRoom } = await import(moduleUrl);
  return PresenceRoom;
}

test('Durable Object restores unique users and a late close cannot delete a new generation', async () => {
  const PresenceRoom = await importPresenceRoom();

  const clientId = 'stable_private_user_0001';
  const userId = 'p.11111111-1111-4111-8111-111111111111';
  const otherClientId = 'other_private_user_0001';
  const otherId = 'p.22222222-2222-4222-8222-222222222222';
  const oldSocket = new FakeSocket(clientId, userId);
  const siblingSocket = new FakeSocket(clientId, userId);
  const otherSocket = new FakeSocket(otherClientId, otherId);
  const room = new PresenceRoom(durableState([oldSocket, siblingSocket, otherSocket]));

  assert.equal(room.peers.size, 3);
  assert.equal(room.users.size, 2);
  assert.equal(room.users.get(clientId).id, userId);
  assert.equal(room.users.get(clientId).connections.size, 2);
  assert.equal(room.tickTimer, null);
  room.pendingCursors.set(userId, { a: 'page', fx: 0, fy: 0, color: 'blue' });
  room.ensureTick();
  assert.notEqual(room.tickTimer, null);
  room.pendingCursors.clear();
  room.cancelTickIfIdle();
  assert.equal(room.tickTimer, null);

  const impersonator = room.userFor(userId);
  assert.notEqual(impersonator.id, userId);
  assert.notEqual(impersonator.id, room.users.get(clientId).id);
  room.users.delete(userId);

  await room.webSocketMessage(
    oldSocket,
    JSON.stringify({ t: 'cursor', a: 'page', fx: 0.1, fy: 40 })
  );
  await room.webSocketMessage(
    siblingSocket,
    JSON.stringify({ t: 'cursor', a: 'page', fx: 0.5, fy: 80 })
  );
  await room.webSocketMessage(oldSocket, JSON.stringify({ t: 'idle' }));
  assert.equal(
    otherSocket.sent.some((message) => message.t === 'idle' && message.id === userId),
    false
  );

  await room.webSocketMessage(
    oldSocket,
    JSON.stringify({ t: 'focus', card: 'dialog' })
  );
  await room.webSocketMessage(
    siblingSocket,
    JSON.stringify({ t: 'focus', card: 'model-picker' })
  );
  await room.webSocketMessage(
    oldSocket,
    JSON.stringify({ t: 'focus', card: null })
  );
  assert.equal(
    otherSocket.sent.at(-1).t === 'focus' && otherSocket.sent.at(-1).card === null,
    false
  );

  await room.webSocketMessage(siblingSocket, JSON.stringify({ t: 'bullet', text: 'hello' }));
  await room.webSocketMessage(
    siblingSocket,
    JSON.stringify({ t: 'loc', loc: { country: 'SG' } })
  );
  await room.webSocketMessage(oldSocket, JSON.stringify({ t: 'spray', on: 1 }));
  await room.webSocketMessage(siblingSocket, JSON.stringify({ t: 'spray', on: 1 }));
  room.tick();
  assert.equal(
    sentCursors(otherSocket, (cursor) => cursor.id === userId).length > 0,
    true
  );
  assert.equal(
    otherSocket.sent.some((message) => message.t === 'bullet' && message.id === userId),
    true
  );
  assert.equal(
    otherSocket.sent.some((message) => message.t === 'loc' && message.id === userId),
    true
  );
  assert.equal(
    siblingSocket.sent.some(
      (message) =>
        message.id === userId &&
        (message.t === 'bullet' || message.t === 'loc')
    ),
    false
  );
  assert.deepEqual(oldSocket.attachment.loc, { country: 'SG' });
  assert.deepEqual(siblingSocket.attachment.loc, { country: 'SG' });
  assert.equal(oldSocket.attachment.lastEvent.id, userId);
  assert.equal(siblingSocket.attachment.lastEvent.id, userId);
  assert.equal(
    otherSocket.sent.filter((message) => message.t === 'spray' && message.id === userId && message.on)
      .length,
    1
  );
  assert.equal(room.tickTimer, null);

  room.drop(oldSocket);
  assert.equal(room.users.size, 2);
  assert.equal(
    otherSocket.sent.some((message) => message.t === 'leave' && message.id === userId),
    false
  );
  assert.equal(
    otherSocket.sent.some(
      (message) => message.t === 'spray' && message.id === userId && !message.on
    ),
    false
  );

  room.drop(siblingSocket);
  assert.equal(room.users.has(clientId), false);
  assert.equal(
    otherSocket.sent.filter((message) => message.t === 'leave' && message.id === userId).length,
    1
  );
  assert.equal(
    otherSocket.sent.filter(
      (message) => message.t === 'spray' && message.id === userId && !message.on
    ).length,
    1
  );
  assert.notEqual(room.tickTimer, null);
  room.tick();
  assert.equal(room.tickTimer, null);

  const replacementUser = room.userFor(clientId);
  const replacement = new FakeSocket(clientId, replacementUser.id);
  const replacementConnection = {
    user: replacementUser,
    idle: true,
    lastEvent: null,
    cursorSeq: 0,
    cursorAt: 0,
    focus: null,
    focusSeq: 0,
    focusRateAt: 0,
    locAt: 0,
    spray: false,
    sprayAt: 0,
  };
  replacementUser.connections.add(replacement);
  room.peers.set(replacement, replacementConnection);
  room.persistUser(replacementUser);

  room.drop(oldSocket);
  assert.equal(room.users.get(clientId), replacementUser);
  assert.equal(replacementUser.connections.has(replacement), true);
  assert.equal(
    otherSocket.sent.filter((message) => message.t === 'leave' && message.id === userId).length,
    1
  );

  room.drop(replacement);
  assert.equal(
    otherSocket.sent.filter(
      (message) => message.t === 'leave' && message.id === replacementUser.id
    ).length,
    1
  );
  room.tick();
  assert.equal(room.tickTimer, null);

  room.publishLike('bridge', 1, otherClientId, true, true);
  assert.notEqual(room.tickTimer, null);
  room.tick();
  assert.equal(room.tickTimer, null);

  room.drop(otherSocket);
  assert.equal(room.tickTimer, null);

  // If the close event itself wakes a hibernated object, the closed socket may
  // no longer be returned by getWebSockets(). Its attachment must still retract
  // the old public id without deleting any reconstructed live user.
  const liveAfterWake = new FakeSocket(otherClientId, otherId);
  const detachedClosed = new FakeSocket(clientId, userId, {
    connection: { spray: true },
  });
  const wokeRoom = new PresenceRoom(durableState([liveAfterWake]));
  assert.equal(wokeRoom.tickTimer, null);
  wokeRoom.drop(detachedClosed);
  assert.equal(
    liveAfterWake.sent.filter((message) => message.t === 'leave' && message.id === userId).length,
    1
  );
  assert.equal(
    liveAfterWake.sent.filter(
      (message) => message.t === 'spray' && message.id === userId && !message.on
    ).length,
    1
  );
  wokeRoom.tick();
  assert.equal(wokeRoom.tickTimer, null);
  wokeRoom.drop(detachedClosed);
  assert.equal(
    liveAfterWake.sent.filter((message) => message.t === 'leave' && message.id === userId).length,
    1
  );
  wokeRoom.drop(liveAfterWake);

  const reconciledClientId = 'reconcile_private_0001';
  const reconciledUserId = 'p.33333333-3333-4333-8333-333333333333';
  const staleCursor = {
    t: 'cursor',
    id: reconciledUserId,
    a: 'page',
    fx: 0.2,
    fy: 20,
  };
  const idleSibling = new FakeSocket(reconciledClientId, reconciledUserId, {
    stateSeq: 3,
    lastEvent: staleCursor,
    idle: false,
    focus: 'dialog',
    spray: true,
    connection: {
      idle: true,
      lastEvent: null,
      cursorSeq: 0,
      focus: null,
      focusSeq: 0,
      spray: false,
    },
  });
  const detachedActive = new FakeSocket(reconciledClientId, reconciledUserId, {
    // Simulate serializeAttachment failing after A became active: its private
    // attachment is stale even though remote peers may have rendered A.
    stateSeq: 0,
    lastEvent: null,
    idle: true,
    focus: null,
    spray: false,
    connection: {
      idle: true,
      lastEvent: null,
      cursorSeq: 0,
      focus: null,
      focusSeq: 0,
      spray: false,
    },
  });
  const idleObserver = new FakeSocket(
    'reconcile_observer_private',
    'p.44444444-4444-4444-8444-444444444444'
  );
  const idleReconcileRoom = new PresenceRoom(
    durableState([idleSibling, idleObserver])
  );
  idleReconcileRoom.drop(detachedActive);
  assert.equal(
    idleObserver.sent.filter(
      (message) => message.t === 'idle' && message.id === reconciledUserId
    ).length,
    1
  );
  assert.equal(
    idleObserver.sent.filter(
      (message) =>
        message.t === 'focus' &&
        message.id === reconciledUserId &&
        message.card === null
    ).length,
    1
  );
  assert.equal(
    idleObserver.sent.filter(
      (message) =>
        message.t === 'spray' &&
        message.id === reconciledUserId &&
        message.on === 0
    ).length,
    1
  );
  assert.equal(
    idleObserver.sent.some(
      (message) => message.t === 'leave' || message.t === 'count'
    ),
    false
  );
  const idleReconciliationCount = idleObserver.sent.length;
  idleReconcileRoom.drop(detachedActive);
  assert.equal(idleObserver.sent.length, idleReconciliationCount);
  idleReconcileRoom.drop(idleSibling);
  idleReconcileRoom.drop(idleObserver);

  const activeClientId = 'active_reconcile_private';
  const activeUserId = 'p.55555555-5555-4555-8555-555555555555';
  const oldActiveCursor = {
    t: 'cursor',
    id: activeUserId,
    a: 'page',
    fx: 0.3,
    fy: 30,
  };
  const siblingCursor = {
    t: 'cursor',
    id: activeUserId,
    a: 'page',
    fx: 0.8,
    fy: 80,
  };
  const activeSibling = new FakeSocket(activeClientId, activeUserId, {
    stateSeq: 8,
    lastEvent: oldActiveCursor,
    idle: false,
    focus: 'dialog',
    spray: true,
    connection: {
      idle: false,
      lastEvent: siblingCursor,
      cursorSeq: 8,
      focus: 'model-picker',
      focusSeq: 8,
      spray: true,
    },
  });
  const detachedOldActive = new FakeSocket(activeClientId, activeUserId, {
    stateSeq: 0,
    lastEvent: null,
    idle: true,
    focus: null,
    spray: false,
    connection: {
      idle: true,
      lastEvent: null,
      cursorSeq: 0,
      focus: null,
      focusSeq: 0,
      spray: false,
    },
  });
  const activeObserver = new FakeSocket(
    'active_observer_private',
    'p.66666666-6666-4666-8666-666666666666'
  );
  const activeReconcileRoom = new PresenceRoom(
    durableState([activeSibling, activeObserver])
  );
  activeReconcileRoom.drop(detachedOldActive);
  assert.equal(
    activeObserver.sent.some(
      (message) =>
        message.t === 'cursor' &&
        message.id === activeUserId &&
        message.fx === siblingCursor.fx
    ),
    true
  );
  assert.equal(
    activeObserver.sent.some(
      (message) =>
        message.t === 'focus' &&
        message.id === activeUserId &&
        message.card === 'model-picker'
    ),
    true
  );
  assert.equal(
    activeObserver.sent.some(
      (message) =>
        message.t === 'spray' &&
        message.id === activeUserId &&
        message.on === 1
    ),
    true
  );
  assert.equal(
    activeObserver.sent.some(
      (message) =>
        message.id === activeUserId &&
        (message.t === 'idle' ||
          message.t === 'leave' ||
          (message.t === 'focus' && message.card === null) ||
          (message.t === 'spray' && message.on === 0))
    ),
    false
  );
  activeReconcileRoom.drop(activeSibling);
  activeReconcileRoom.drop(activeObserver);

  // Cursor delivery remains latest-wins when a room crosses the old realtime
  // threshold: small rooms use the same batched path as crowded rooms.
  const crowdedSockets = Array.from({ length: 13 }, (_, index) => {
    const suffix = (index + 1).toString(16).padStart(12, '0');
    return new FakeSocket(
      `crowd_private_${String(index).padStart(4, '0')}`,
      `p.00000000-0000-4000-8000-${suffix}`
    );
  });
  const crowdedRoom = new PresenceRoom(durableState(crowdedSockets));
  const crowdedSender = crowdedSockets[0];
  const crowdedObserver = crowdedSockets[1];
  const crowdedSenderId = crowdedSender.attachment.userId;
  await crowdedRoom.webSocketMessage(
    crowdedSender,
    JSON.stringify({ t: 'cursor', a: 'page', fx: 0.1, fy: 10 })
  );
  assert.equal(crowdedRoom.pendingCursors.has(crowdedSenderId), true);

  crowdedRoom.drop(crowdedSockets[12]);
  assert.equal(crowdedRoom.users.size, 12);
  crowdedRoom.peers.get(crowdedSender).cursorAt = 0;
  await crowdedRoom.webSocketMessage(
    crowdedSender,
    JSON.stringify({ t: 'cursor', a: 'page', fx: 0.9, fy: 90 })
  );
  assert.equal(crowdedRoom.pendingCursors.has(crowdedSenderId), true);
  assert.equal(
    crowdedObserver.sent.some(
      (message) =>
        message.t === 'cursor' && message.id === crowdedSenderId && message.fx === 0.9
    ),
    false
  );
  crowdedRoom.tick();
  assert.deepEqual(
    sentCursors(
      crowdedObserver,
      (cursor) => cursor.id === crowdedSenderId
    ).map((cursor) => cursor.fx),
    [0.9]
  );
  for (const socket of crowdedSockets) crowdedRoom.drop(socket);
  assert.equal(crowdedRoom.tickTimer, null);
});

test('PresenceRoom treats thirteen tabs from one user as crowded', async () => {
  const PresenceRoom = await importPresenceRoom();
  const clientId = 'many_tabs_private_user_0001';
  const userId = 'p.70707070-7070-4070-8070-707070707070';
  const tabs = Array.from(
    { length: 13 },
    () => new FakeSocket(clientId, userId)
  );
  const observer = new FakeSocket(
    'many_tabs_observer_0001',
    'p.71717171-7171-4171-8171-717171717171'
  );
  const room = new PresenceRoom(durableState([...tabs, observer]));
  const sender = tabs[0];
  const session = 'many_tabs_chat_session_01';

  assert.equal(room.users.size, 2);
  assert.equal(room.peers.size, 14);
  assert.equal(room.users.get(clientId).connections.size, 13);
  assert.equal(room.isRealtimeRoom(), false);

  await room.webSocketMessage(
    sender,
    JSON.stringify({ t: 'cursor', a: 'page', fx: 0.25, fy: 75 })
  );
  await room.webSocketMessage(
    sender,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 1,
      text: 'coalesce many tabs',
      a: 'page',
      fx: 0.25,
      fy: 75,
      ttlMs: 5000,
    })
  );

  assert.equal(room.pendingCursors.has(userId), true);
  assert.equal(room.pendingChats.has(userId), true);
  assert.equal(
    observer.sent.some(
      (message) =>
        (message.t === 'cursor' || message.t === 'chat') &&
        message.id === userId
    ),
    false
  );

  room.tick();
  assert.equal(
    observer.sent.some(
      (message) =>
        message.t === 'cursors' &&
        message.list.some((cursor) => cursor.id === userId)
    ),
    true
  );
  assert.equal(
    observer.sent.some(
      (message) =>
        message.t === 'chats' &&
        message.list.some(
          (chat) => chat.id === userId && chat.text === 'coalesce many tabs'
        )
    ),
    true
  );

  const replacement = tabs[1];
  const replacementSession = 'many_tabs_takeover_session_1';
  await room.webSocketMessage(
    replacement,
    JSON.stringify({
      t: 'chat',
      session: replacementSession,
      seq: 1,
      text: 'another tab takes over',
      a: 'page',
      fx: 0.6,
      fy: 90,
      ttlMs: 5000,
    })
  );
  room.tick();

  const oldConnection = room.peers.get(sender);
  oldConnection.chatTokens = 3;
  oldConnection.chatTokenAt = Number.MAX_SAFE_INTEGER;
  const chatsBeforeSupersededTraffic = sentChats(observer).length;
  await room.webSocketMessage(
    sender,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 2,
      text: 'superseded traffic must not spend chat budget',
      a: 'page',
      fx: 0.3,
      fy: 80,
      ttlMs: 5000,
    })
  );
  room.tick();
  assert.equal(oldConnection.chatTokens, 3);
  assert.equal(oldConnection.chatSeqs.get(session), 2);
  assert.deepEqual(
    sender.attachment.connection.chatSeqs.find(
      ([storedSession]) => storedSession === session
    ),
    [session, 2]
  );
  assert.equal(room.users.get(clientId).chat.session, replacementSession);
  assert.equal(sentChats(observer).length, chatsBeforeSupersededTraffic);

  for (const socket of tabs) room.drop(socket);
  room.drop(observer);
  assert.equal(room.tickTimer, null);
});

test('PresenceRoom chat keeps one latest owner and clears on idle or final drop', async () => {
  const PresenceRoom = await importPresenceRoom();
  const clientId = 'chat_room_private_user_0001';
  const userId = 'p.77777777-7777-4777-8777-777777777777';
  const observerClientId = 'chat_room_observer_00001';
  const observerId = 'p.88888888-8888-4888-8888-888888888888';
  const oldSocket = new FakeSocket(clientId, userId);
  const replacement = new FakeSocket(clientId, userId);
  const observer = new FakeSocket(observerClientId, observerId);
  const room = new PresenceRoom(
    durableState([oldSocket, replacement, observer])
  );

  const oldSession = 'room_old_session_0001';
  await room.webSocketMessage(
    oldSocket,
    JSON.stringify({
      t: 'chat',
      session: oldSession,
      seq: 1,
      text: 'first owner',
      a: 'page',
      fx: 0.2,
      fy: 100,
      ttlMs: 5000,
    })
  );
  assert.equal(sentChats(observer).length, 0);
  assert.equal(room.pendingChats.has(userId), true);
  room.tick();
  const first = sentChats(
    observer,
    (chat) => chat.id === userId && chat.text === 'first owner'
  ).at(-1);
  assert.equal(first?.color, room.users.get(clientId).color);
  assert.equal(Number.isSafeInteger(first?.rev), true);
  assert.equal(first?.ttlMs > 0 && first.ttlMs <= 5000, true);
  assert.equal(JSON.stringify(first).includes(clientId), false);
  assert.equal(
    replacement.sent.some(
      (message) => message.t === 'chat' && message.id === userId
    ),
    false
  );

  const replacementSession = 'room_new_session_0001';
  await room.webSocketMessage(
    replacement,
    JSON.stringify({
      t: 'chat',
      session: replacementSession,
      seq: 1,
      text: 'replacement owner',
      a: 'card:dialog',
      fx: 0.6,
      fy: 0.4,
      ttlMs: 5000,
    })
  );
  room.tick();
  const replacementChat = sentChats(
    observer,
    (chat) => chat.id === userId && chat.text === 'replacement owner'
  ).at(-1);
  assert.equal(replacementChat.rev > first.rev, true);

  const beforeStaleTraffic = sentChats(observer).length;
  await room.webSocketMessage(
    oldSocket,
    JSON.stringify({
      t: 'chat',
      session: oldSession,
      seq: 2,
      text: 'superseded room session stays stale',
      a: 'page',
      fx: 0.2,
      fy: 100,
      ttlMs: 5000,
    })
  );
  await room.webSocketMessage(
    oldSocket,
    JSON.stringify({
      t: 'chat',
      session: oldSession,
      seq: 3,
      text: '',
      a: 'page',
      fx: 0.2,
      fy: 100,
      ttlMs: 5000,
    })
  );
  await room.webSocketMessage(oldSocket, JSON.stringify({ t: 'idle' }));
  assert.equal(sentChats(observer).length, beforeStaleTraffic);

  const oldReturnSession = 'room_old_return_session_01';
  await room.webSocketMessage(
    oldSocket,
    JSON.stringify({
      t: 'chat',
      session: oldReturnSession,
      seq: 1,
      text: 'old room connection returns',
      a: 'page',
      fx: 0.3,
      fy: 120,
      ttlMs: 5000,
    })
  );
  room.tick();
  const oldReturnChat = sentChats(
    observer,
    (chat) => chat.id === userId && chat.text === 'old room connection returns'
  ).at(-1);
  assert.equal(oldReturnChat.rev > replacementChat.rev, true);

  const replacementReturnSession = 'room_replacement_return_01';
  await room.webSocketMessage(
    replacement,
    JSON.stringify({
      t: 'chat',
      session: replacementReturnSession,
      seq: 1,
      text: 'replacement room connection returns',
      a: 'page',
      fx: 0.6,
      fy: 121,
      ttlMs: 5000,
    })
  );
  room.tick();
  const replacementReturnChat = sentChats(
    observer,
    (chat) =>
      chat.id === userId && chat.text === 'replacement room connection returns'
  ).at(-1);
  assert.equal(replacementReturnChat.rev > oldReturnChat.rev, true);

  // Repeated live updates do not touch the independent bullet token bucket.
  for (let seq = 2; seq <= 8; seq++) {
    await room.webSocketMessage(
      replacement,
      JSON.stringify({
        t: 'chat',
        session: replacementReturnSession,
        seq,
        text: `replacement ${seq}`,
        a: 'page',
        fx: 0.6,
        fy: 100 + seq,
        ttlMs: 5000,
      })
    );
  }
  const bulletCountBefore = observer.sent.filter(
    (message) => message.t === 'bullet' && message.id === userId
  ).length;
  for (const text of ['one', 'two', 'three']) {
    await room.webSocketMessage(
      replacement,
      JSON.stringify({ t: 'bullet', text })
    );
  }
  assert.equal(
    observer.sent.filter(
      (message) => message.t === 'bullet' && message.id === userId
    ).length -
      bulletCountBefore,
    3
  );

  await room.webSocketMessage(
    replacement,
    JSON.stringify({
      t: 'chat',
      session: replacementReturnSession,
      seq: 9,
      text: '',
      a: 'page',
      fx: 0.6,
      fy: 109,
      ttlMs: 5000,
    })
  );
  const explicitClear = sentChats(
    observer,
    (chat) => chat.id === userId && chat.text === ''
  ).at(-1);
  assert.equal(explicitClear.ttlMs, 0);

  const idleSession = 'room_idle_session_0001';
  await room.webSocketMessage(
    replacement,
    JSON.stringify({
      t: 'chat',
      session: idleSession,
      seq: 1,
      text: 'idle cleanup',
      a: 'page',
      fx: 0.7,
      fy: 150,
      ttlMs: 5000,
    })
  );
  const clearsBeforeIdle = sentChats(
    observer,
    (chat) => chat.id === userId && chat.text === ''
  ).length;
  await room.webSocketMessage(replacement, JSON.stringify({ t: 'idle' }));
  assert.equal(
    sentChats(
      observer,
      (chat) => chat.id === userId && chat.text === ''
    ).length,
    clearsBeforeIdle + 1
  );

  const finalSession = 'room_final_session_0001';
  await room.webSocketMessage(
    replacement,
    JSON.stringify({
      t: 'chat',
      session: finalSession,
      seq: 1,
      text: 'final drop cleanup',
      a: 'page',
      fx: 0.8,
      fy: 180,
      ttlMs: 5000,
    })
  );
  const clearsBeforeDrop = sentChats(
    observer,
    (chat) => chat.id === userId && chat.text === ''
  ).length;
  room.drop(oldSocket);
  assert.equal(
    sentChats(
      observer,
      (chat) => chat.id === userId && chat.text === ''
    ).length,
    clearsBeforeDrop
  );
  room.drop(replacement);
  assert.equal(
    sentChats(
      observer,
      (chat) => chat.id === userId && chat.text === ''
    ).length,
    clearsBeforeDrop + 1
  );
  assert.equal(
    observer.sent.filter(
      (message) => message.t === 'leave' && message.id === userId
    ).length,
    1
  );
  room.tick();
  room.drop(observer);
  assert.equal(room.tickTimer, null);
});

test('PresenceRoom coalesces hot attachment writes and only serializes changed sockets', async () => {
  const PresenceRoom = await importPresenceRoom();
  const clientId = 'precise_attachment_user_0001';
  const userId = 'p.72727272-7272-4272-8272-727272727272';
  const first = new FakeSocket(clientId, userId);
  const sibling = new FakeSocket(clientId, userId);
  const observer = new FakeSocket(
    'precise_attachment_observer_01',
    'p.73737373-7373-4373-8373-737373737373'
  );
  const room = new PresenceRoom(durableState([first, sibling, observer]));
  const initialFirstWrites = first.serializeCount;
  const initialSiblingWrites = sibling.serializeCount;
  const initialObserverWrites = observer.serializeCount;

  const ordinaryMessages = [
    { t: 'cursor', a: 'page', fx: 0.2, fy: 20 },
    { t: 'focus', card: 'dialog' },
    { t: 'loc', loc: { country: 'SG' } },
    { t: 'spray', on: 1 },
    { t: 'idle' },
  ];
  for (const message of ordinaryMessages) {
    await room.webSocketMessage(first, JSON.stringify(message));
  }

  assert.equal(
    first.serializeCount,
    initialFirstWrites + ordinaryMessages.length - 1
  );
  assert.equal(sibling.serializeCount, initialSiblingWrites);
  assert.equal(observer.serializeCount, initialObserverWrites);
  assert.deepEqual(first.attachment.loc, { country: 'SG' });
  assert.equal(sibling.attachment.loc, null);

  const firstSession = 'precise_attachment_first_01';
  const beforeFirstChat = {
    first: first.serializeCount,
    sibling: sibling.serializeCount,
    observer: observer.serializeCount,
  };
  await room.webSocketMessage(
    first,
    JSON.stringify({
      t: 'chat',
      session: firstSession,
      seq: 1,
      text: 'first owns chat',
      a: 'page',
      fx: 0.3,
      fy: 30,
      ttlMs: 5000,
    })
  );
  assert.equal(first.serializeCount, beforeFirstChat.first);
  await room.webSocketMessage(
    first,
    JSON.stringify({
      t: 'chat',
      session: firstSession,
      seq: 2,
      text: 'first owns latest chat',
      a: 'page',
      fx: 0.35,
      fy: 35,
      ttlMs: 5000,
    })
  );
  assert.equal(first.serializeCount, beforeFirstChat.first);
  room.tick();
  assert.equal(first.serializeCount, beforeFirstChat.first + 1);
  assert.equal(sibling.serializeCount, beforeFirstChat.sibling);
  assert.equal(observer.serializeCount, beforeFirstChat.observer);
  assert.equal(first.attachment.connection.chat.text, 'first owns latest chat');
  assert.deepEqual(
    first.attachment.connection.chatSeqs.find(
      ([storedSession]) => storedSession === firstSession
    ),
    [firstSession, 2]
  );

  const siblingSession = 'precise_attachment_second_1';
  const beforeTakeover = {
    first: first.serializeCount,
    sibling: sibling.serializeCount,
    observer: observer.serializeCount,
  };
  await room.webSocketMessage(
    sibling,
    JSON.stringify({
      t: 'chat',
      session: siblingSession,
      seq: 1,
      text: 'sibling takes over',
      a: 'page',
      fx: 0.7,
      fy: 70,
      ttlMs: 5000,
    })
  );
  assert.equal(sibling.serializeCount, beforeTakeover.sibling);
  room.tick();

  assert.equal(first.serializeCount, beforeTakeover.first + 1);
  assert.equal(sibling.serializeCount, beforeTakeover.sibling + 1);
  assert.equal(observer.serializeCount, beforeTakeover.observer);
  assert.equal(first.attachment.connection.chat, null);
  assert.equal(
    first.attachment.connection.chatSupersededSessions.includes(firstSession),
    true
  );
  assert.equal(
    sibling.attachment.connection.chat.session,
    siblingSession
  );

  room.drop(first);
  room.drop(sibling);
  room.drop(observer);
  assert.equal(room.tickTimer, null);
});

test('PresenceRoom evicts a chat owner when an explicit clear cannot be persisted', async () => {
  const PresenceRoom = await importPresenceRoom();
  const clientId = 'chat_clear_persist_user_001';
  const userId = 'p.74747474-7474-4474-8474-747474747474';
  const session = 'chat_clear_persist_session_1';
  const owner = new FakeSocket(clientId, userId);
  const sibling = new FakeSocket(clientId, userId);
  const observer = new FakeSocket(
    'chat_clear_persist_observer',
    'p.75757575-7575-4575-8575-757575757575'
  );
  const room = new PresenceRoom(durableState([owner, sibling, observer]));

  await room.webSocketMessage(
    owner,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 1,
      text: 'must not resurrect after clear',
      a: 'page',
      fx: 0.4,
      fy: 140,
      ttlMs: 5000,
    })
  );
  room.tick();
  assert.equal(owner.attachment.connection.chat.session, session);

  owner.serializeFailures = 1;
  const messagesBeforeClear = sentChats(observer).length;
  await room.webSocketMessage(
    owner,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 2,
      text: '',
      a: 'page',
      fx: 0.4,
      fy: 140,
      ttlMs: 5000,
    })
  );
  await Promise.resolve();

  const clear = sentChats(observer)[messagesBeforeClear];
  assert.equal(clear.text, '');
  assert.equal(clear.ttlMs, 0);
  assert.equal(owner.closeCount, 1);
  assert.equal(room.peers.has(owner), false);
  assert.equal(room.failedSockets.has(owner), false);
  assert.equal(room.users.get(clientId).chat, null);
  assert.equal(
    owner.attachment.connection.chat.text,
    'must not resurrect after clear'
  );
  assert.equal(sibling.attachment.connection.chat, null);

  const restoredSibling = new FakeSocket(clientId, userId);
  restoredSibling.attachment = structuredClone(sibling.attachment);
  const restoredObserver = new FakeSocket(
    'chat_clear_restored_observer',
    'p.76767676-7676-4676-8676-767676767676'
  );
  const restoredRoom = new PresenceRoom(
    durableState([restoredSibling, restoredObserver])
  );
  assert.equal(restoredRoom.users.get(clientId).chat, null);
  assert.equal(
    restoredRoom.chatRosterEntry(restoredRoom.users.get(clientId)),
    null
  );

  room.drop(sibling);
  room.drop(observer);
  restoredRoom.drop(restoredSibling);
  restoredRoom.drop(restoredObserver);
  assert.equal(room.tickTimer, null);
  assert.equal(restoredRoom.tickTimer, null);
});

test('PresenceRoom evicts a stale sibling when takeover persistence fails', async () => {
  const PresenceRoom = await importPresenceRoom();
  const clientId = 'chat_takeover_persist_user_1';
  const userId = 'p.77747474-7474-4474-8474-747474747474';
  const oldSession = 'chat_takeover_old_session_01';
  const newSession = 'chat_takeover_new_session_01';
  const oldOwner = new FakeSocket(clientId, userId);
  const replacement = new FakeSocket(clientId, userId);
  const observer = new FakeSocket(
    'chat_takeover_persist_observer',
    'p.78787878-7878-4878-8878-787878787878'
  );
  const room = new PresenceRoom(
    durableState([oldOwner, replacement, observer])
  );

  await room.webSocketMessage(
    oldOwner,
    JSON.stringify({
      t: 'chat',
      session: oldSession,
      seq: 1,
      text: 'stale owner attachment',
      a: 'page',
      fx: 0.2,
      fy: 100,
      ttlMs: 5000,
    })
  );
  room.tick();
  oldOwner.serializeFailures = 1;

  await room.webSocketMessage(
    replacement,
    JSON.stringify({
      t: 'chat',
      session: newSession,
      seq: 1,
      text: 'replacement survives',
      a: 'page',
      fx: 0.7,
      fy: 160,
      ttlMs: 5000,
    })
  );
  await Promise.resolve();

  assert.equal(oldOwner.closeCount, 1);
  assert.equal(room.peers.has(oldOwner), false);
  assert.equal(
    oldOwner.attachment.connection.chat.text,
    'stale owner attachment'
  );
  assert.equal(room.users.get(clientId).chat.session, newSession);
  assert.equal(replacement.attachment.connection.chat.session, newSession);

  const restoredReplacement = new FakeSocket(clientId, userId);
  restoredReplacement.attachment = structuredClone(replacement.attachment);
  const restoredObserver = new FakeSocket(
    'chat_takeover_restored_observer',
    'p.79797979-7979-4979-8979-797979797979'
  );
  const restoredRoom = new PresenceRoom(
    durableState([restoredReplacement, restoredObserver])
  );
  assert.equal(restoredRoom.users.get(clientId).chat.session, newSession);
  assert.equal(restoredRoom.users.get(clientId).chat.text, 'replacement survives');

  room.drop(replacement);
  room.drop(observer);
  restoredRoom.drop(restoredReplacement);
  restoredRoom.drop(restoredObserver);
  assert.equal(room.tickTimer, null);
  assert.equal(restoredRoom.tickTimer, null);
});

test('PresenceRoom restores unexpired chat attachment and forgets expired text', async () => {
  const PresenceRoom = await importPresenceRoom();
  const now = Date.now();
  const activeClientId = 'chat_restore_private_0001';
  const activeUserId = 'p.99999999-9999-4999-8999-999999999999';
  const activeSession = 'restore_active_session_01';
  const supersededSession = 'restore_superseded_0001';
  const restoredChat = {
    session: activeSession,
    rev: 11,
    text: '恢复 mixed 🙂',
    a: 'page',
    fx: 0.35,
    fy: 210,
    expiresAt: now + 2000,
  };
  const activeSocket = new FakeSocket(activeClientId, activeUserId, {
    stateSeq: 11,
    connection: {
      idle: false,
      lastEvent: null,
      cursorSeq: 0,
      focus: null,
      focusSeq: 0,
      spray: false,
      chat: restoredChat,
      chatSeqs: [
        [activeSession, 4],
        [supersededSession, 7],
      ],
      chatSupersededSessions: [supersededSession],
    },
  });
  const activeObserver = new FakeSocket(
    'chat_restore_observer_01',
    'p.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  const activeRoom = new PresenceRoom(
    durableState([activeSocket, activeObserver])
  );
  const restoredConnection = activeRoom.peers.get(activeSocket);
  assert.deepEqual(restoredConnection.chat, restoredChat);
  assert.equal(activeRoom.users.get(activeClientId).chat.text, restoredChat.text);
  assert.equal(
    restoredConnection.supersededChatSessions.has(supersededSession),
    true
  );

  const activeMessagesBefore = sentChats(activeObserver).length;
  await activeRoom.webSocketMessage(
    activeSocket,
    JSON.stringify({
      t: 'chat',
      session: supersededSession,
      seq: 8,
      text: 'hibernated stale session must not return',
      a: 'page',
      fx: 0.4,
      fy: 220,
      ttlMs: 5000,
    })
  );
  assert.equal(sentChats(activeObserver).length, activeMessagesBefore);

  await activeRoom.webSocketMessage(
    activeSocket,
    JSON.stringify({
      t: 'chat',
      session: activeSession,
      seq: 4,
      text: 'replayed seq',
      a: 'page',
      fx: 0.4,
      fy: 220,
      ttlMs: 5000,
    })
  );
  assert.equal(sentChats(activeObserver).length, activeMessagesBefore);

  await activeRoom.webSocketMessage(
    activeSocket,
    JSON.stringify({
      t: 'chat',
      session: activeSession,
      seq: 5,
      text: 'new seq accepted',
      a: 'page',
      fx: 0.4,
      fy: 220,
      ttlMs: 5000,
    })
  );
  activeRoom.tick();
  assert.equal(
    sentChats(
      activeObserver,
      (chat) => chat.id === activeUserId && chat.text === 'new seq accepted'
    ).length,
    1
  );
  assert.equal(activeSocket.attachment.connection.chat.session, activeSession);
  assert.deepEqual(
    activeSocket.attachment.connection.chatSeqs.find(
      ([session]) => session === activeSession
    ),
    [activeSession, 5]
  );
  assert.equal(
    activeSocket.attachment.connection.chatSupersededSessions.includes(
      supersededSession
    ),
    true
  );

  const expiredClientId = 'chat_expired_private_0001';
  const expiredUserId = 'p.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const expiredSession = 'restore_expired_session_1';
  const expiredSocket = new FakeSocket(expiredClientId, expiredUserId, {
    stateSeq: 20,
    connection: {
      idle: false,
      lastEvent: null,
      cursorSeq: 0,
      focus: null,
      focusSeq: 0,
      spray: false,
      chat: {
        session: expiredSession,
        rev: 20,
        text: 'already stale',
        a: 'page',
        fx: 0.5,
        fy: 230,
        expiresAt: now - 1000,
      },
      chatSeqs: [[expiredSession, 8]],
    },
  });
  const expiredObserver = new FakeSocket(
    'chat_expired_observer_01',
    'p.cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  const expiredRoom = new PresenceRoom(
    durableState([expiredSocket, expiredObserver])
  );
  assert.equal(expiredRoom.peers.get(expiredSocket).chat, null);
  assert.equal(expiredRoom.users.get(expiredClientId).chat, null);

  await expiredRoom.webSocketMessage(
    expiredSocket,
    JSON.stringify({
      t: 'chat',
      session: expiredSession,
      seq: 8,
      text: 'expired seq replay',
      a: 'page',
      fx: 0.5,
      fy: 240,
      ttlMs: 5000,
    })
  );
  assert.equal(sentChats(expiredObserver).length, 0);

  await expiredRoom.webSocketMessage(
    expiredSocket,
    JSON.stringify({
      t: 'chat',
      session: expiredSession,
      seq: 9,
      text: 'expired session advances',
      a: 'page',
      fx: 0.5,
      fy: 240,
      ttlMs: 5000,
    })
  );
  expiredRoom.tick();
  assert.equal(
    sentChats(
      expiredObserver,
      (chat) =>
        chat.id === expiredUserId && chat.text === 'expired session advances'
    ).length,
    1
  );

  activeRoom.drop(activeSocket);
  activeRoom.drop(activeObserver);
  expiredRoom.drop(expiredSocket);
  expiredRoom.drop(expiredObserver);
  assert.equal(activeRoom.tickTimer, null);
  assert.equal(expiredRoom.tickTimer, null);
});

test('PresenceRoom bounds chat session histories across serialization and restore', async () => {
  const PresenceRoom = await importPresenceRoom();
  const clientId = 'chat_history_private_0001';
  const userId = 'p.eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const sender = new FakeSocket(clientId, userId);
  const observer = new FakeSocket(
    'chat_history_observer_001',
    'p.ffffffff-ffff-4fff-8fff-ffffffffffff'
  );
  const room = new PresenceRoom(durableState([sender, observer]));
  let activeSession = '';

  for (let index = 0; index < 70; index++) {
    activeSession = `history_${String(index).padStart(4, '0')}_session`;
    await room.webSocketMessage(
      sender,
      JSON.stringify({
        t: 'chat',
        session: activeSession,
        seq: 1,
        text: `history ${index}`,
        a: 'page',
        fx: 0.5,
        fy: 200 + index,
        ttlMs: 5000,
      })
    );
  }
  room.tick();

  const liveConnection = room.peers.get(sender);
  assert.equal(liveConnection.chat.session, activeSession);
  assert.equal(liveConnection.chatSeqs.size <= 64, true);
  assert.equal(liveConnection.chatSeqs.get(activeSession), 1);
  assert.equal(liveConnection.supersededChatSessions.size <= 64, true);
  assert.equal(
    sender.attachment.connection.chatSeqs.length <= 64,
    true
  );
  assert.equal(
    sender.attachment.connection.chatSupersededSessions.length <= 64,
    true
  );

  // Simulate an oversized attachment from an older build. The active session
  // is deliberately the oldest sequence entry; restore must retain it while
  // evicting other insertion-ordered history.
  const serialized = structuredClone(sender.attachment);
  const overflowSessions = Array.from(
    { length: 70 },
    (_, index) => `overflow_${String(index).padStart(4, '0')}_session`
  );
  serialized.connection.chatSeqs = [
    [activeSession, 1],
    ...overflowSessions.map((session) => [session, 1]),
  ];
  serialized.connection.chatSupersededSessions = [...overflowSessions];

  const restoredSender = new FakeSocket(clientId, userId);
  restoredSender.attachment = serialized;
  const restoredObserver = new FakeSocket(
    'chat_history_observer_002',
    'p.12121212-1212-4212-8212-121212121212'
  );
  const restoredRoom = new PresenceRoom(
    durableState([restoredSender, restoredObserver])
  );
  const restoredConnection = restoredRoom.peers.get(restoredSender);
  assert.equal(restoredConnection.chat.session, activeSession);
  assert.equal(restoredConnection.chatSeqs.size <= 64, true);
  assert.equal(restoredConnection.chatSeqs.get(activeSession), 1);
  assert.equal(restoredConnection.supersededChatSessions.size <= 64, true);

  const messagesBeforeReplay = sentChats(restoredObserver).length;
  await restoredRoom.webSocketMessage(
    restoredSender,
    JSON.stringify({
      t: 'chat',
      session: activeSession,
      seq: 1,
      text: 'active seq replay',
      a: 'page',
      fx: 0.5,
      fy: 280,
      ttlMs: 5000,
    })
  );
  assert.equal(sentChats(restoredObserver).length, messagesBeforeReplay);

  await restoredRoom.webSocketMessage(
    restoredSender,
    JSON.stringify({
      t: 'chat',
      session: activeSession,
      seq: 2,
      text: 'active seq advances',
      a: 'page',
      fx: 0.5,
      fy: 280,
      ttlMs: 5000,
    })
  );
  restoredRoom.tick();
  assert.equal(
    sentChats(
      restoredObserver,
      (chat) => chat.id === userId && chat.text === 'active seq advances'
    ).length,
    1
  );
  assert.equal(restoredConnection.chatSeqs.get(activeSession), 2);
  assert.equal(restoredConnection.chatSeqs.size <= 64, true);
  assert.equal(restoredConnection.supersededChatSessions.size <= 64, true);
  assert.equal(
    restoredSender.attachment.connection.chatSeqs.length <= 64,
    true
  );
  assert.equal(
    restoredSender.attachment.connection.chatSupersededSessions.length <= 64,
    true
  );

  room.drop(sender);
  room.drop(observer);
  restoredRoom.drop(restoredSender);
  restoredRoom.drop(restoredObserver);
  assert.equal(room.tickTimer, null);
  assert.equal(restoredRoom.tickTimer, null);
});

test('PresenceRoom coalesces crowded chat updates and never delays clear', async () => {
  const PresenceRoom = await importPresenceRoom();
  const sockets = Array.from({ length: 13 }, (_, index) => {
    const suffix = (index + 40).toString(16).padStart(12, '0');
    return new FakeSocket(
      `chat_crowd_private_${String(index).padStart(4, '0')}`,
      `p.dddddddd-dddd-4ddd-8ddd-${suffix}`
    );
  });
  const room = new PresenceRoom(durableState(sockets));
  const sender = sockets[0];
  const observer = sockets[1];
  const senderId = sender.attachment.userId;
  const session = 'crowded_chat_session_01';

  await room.webSocketMessage(
    sender,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 1,
      text: 'queued old value',
      a: 'page',
      fx: 0.2,
      fy: 120,
      ttlMs: 5000,
    })
  );
  await room.webSocketMessage(
    sender,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 2,
      text: 'queued latest value',
      a: 'page',
      fx: 0.8,
      fy: 180,
      ttlMs: 5000,
    })
  );
  assert.equal(sentChats(observer).length, 0);
  assert.notEqual(room.tickTimer, null);

  room.tick();
  const batch = observer.sent.find((message) => message.t === 'chats');
  assert.ok(batch);
  const batchedChat = batch.list.find((chat) => chat.id === senderId);
  assert.deepEqual(
    {
      text: batchedChat.text,
      a: batchedChat.a,
      fx: batchedChat.fx,
      fy: batchedChat.fy,
      color: batchedChat.color,
    },
    {
      text: 'queued latest value',
      a: 'page',
      fx: 0.8,
      fy: 180,
      color: room.users.get(sender.attachment.clientId).color,
    }
  );
  assert.equal(Number.isSafeInteger(batchedChat.rev), true);
  assert.equal(batchedChat.ttlMs > 0 && batchedChat.ttlMs <= 5000, true);
  assert.equal(JSON.stringify(batch).includes(sender.attachment.clientId), false);

  const senderConnection = room.peers.get(sender);
  senderConnection.chatTokens = 0;
  senderConnection.chatTokenAt = 1000;
  assert.equal(room.chatBudgetOk(senderConnection, 1040), true);
  assert.equal(senderConnection.chatTokens, 0);

  senderConnection.chatTokens = 8;
  senderConnection.chatTokenAt = 2000;
  for (let index = 0; index < 8; index++) {
    assert.equal(room.chatBudgetOk(senderConnection, 2000), true);
  }
  assert.equal(room.chatBudgetOk(senderConnection, 2000), false);

  senderConnection.chatTokens = 0;
  senderConnection.chatTokenAt = Number.MAX_SAFE_INTEGER;
  await room.webSocketMessage(
    sender,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 3,
      text: 'must be rate limited',
      a: 'page',
      fx: 0.7,
      fy: 200,
      ttlMs: 5000,
    })
  );
  room.tick();
  assert.equal(room.users.get(sender.attachment.clientId).chat.text, 'queued latest value');
  assert.equal(room.pendingChats.has(senderId), false);
  assert.equal(senderConnection.chatSeqs.get(session), 3);
  assert.deepEqual(
    sender.attachment.connection.chatSeqs.find(
      ([storedSession]) => storedSession === session
    ),
    [session, 3]
  );

  senderConnection.chatTokens = 8;
  const tokensBeforeReplay = senderConnection.chatTokens;
  await room.webSocketMessage(
    sender,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 3,
      text: 'rate-limited seq must not replay',
      a: 'page',
      fx: 0.7,
      fy: 200,
      ttlMs: 5000,
    })
  );
  assert.equal(senderConnection.chatTokens, tokensBeforeReplay);
  assert.equal(room.users.get(sender.attachment.clientId).chat.text, 'queued latest value');

  senderConnection.chatTokens = 0;
  senderConnection.chatTokenAt = Number.MAX_SAFE_INTEGER;
  const messagesBeforeClear = observer.sent.length;
  await room.webSocketMessage(
    sender,
    JSON.stringify({
      t: 'chat',
      session,
      seq: 4,
      text: '',
      a: 'page',
      fx: 0.7,
      fy: 200,
      ttlMs: 5000,
    })
  );
  const immediate = observer.sent[messagesBeforeClear];
  assert.equal(immediate.t, 'chat');
  assert.equal(immediate.id, senderId);
  assert.equal(immediate.text, '');
  assert.equal(immediate.ttlMs, 0);
  assert.equal(senderConnection.chatTokens, 0);

  const batchCountBeforeFinalTick = observer.sent.filter(
    (message) => message.t === 'chats'
  ).length;
  room.tick();
  assert.equal(
    observer.sent.filter((message) => message.t === 'chats').length,
    batchCountBeforeFinalTick
  );

  for (const socket of sockets) room.drop(socket);
  assert.equal(room.tickTimer, null);
});
