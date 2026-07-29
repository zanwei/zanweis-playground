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
  }

  deserializeAttachment() {
    return this.attachment;
  }

  serializeAttachment(value) {
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

test('Durable Object restores unique users and a late close cannot delete a new generation', async () => {
  const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  const testableSource = source.replace(
    "import { WorkerEntrypoint } from 'cloudflare:workers';",
    'class WorkerEntrypoint {}'
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`;
  const { PresenceRoom } = await import(moduleUrl);

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
  assert.equal(
    otherSocket.sent.some((message) => message.t === 'cursor' && message.id === userId),
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
        (message.t === 'cursor' || message.t === 'bullet' || message.t === 'loc')
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

  // A cursor queued in the 13-user coalesced tier must be discarded when the
  // room drops to 12 users and that same user sends a newer realtime cursor.
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
  assert.equal(crowdedRoom.pendingCursors.has(crowdedSenderId), false);
  assert.equal(
    crowdedObserver.sent.some(
      (message) =>
        message.t === 'cursor' && message.id === crowdedSenderId && message.fx === 0.9
    ),
    true
  );
  crowdedRoom.tick();
  assert.equal(
    crowdedObserver.sent.some(
      (message) =>
        message.t === 'cursors' &&
        message.list.some((entry) => entry.id === crowdedSenderId)
    ),
    false
  );
  for (const socket of crowdedSockets) crowdedRoom.drop(socket);
  assert.equal(crowdedRoom.tickTimer, null);
});
