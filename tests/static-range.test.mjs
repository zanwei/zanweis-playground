import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const FIXTURE_URL = new URL('../robots.txt', import.meta.url);

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function startLocalServer(t) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('local server did not start')),
      2000
    );
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`local server exited early (${code})`));
    });
    child.stdout.once('data', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return `http://127.0.0.1:${port}/robots.txt`;
}

async function responseBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

function assertStaticHeaders(response) {
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
}

test('static files support GET and HEAD single byte ranges', async (t) => {
  const fixture = await readFile(FIXTURE_URL);
  const url = await startLocalServer(t);

  const whole = await fetch(url);
  assert.equal(whole.status, 200);
  assertStaticHeaders(whole);
  assert.equal(whole.headers.get('content-length'), String(fixture.length));
  assert.deepEqual(await responseBytes(whole), fixture);

  const wholeHead = await fetch(url, { method: 'HEAD' });
  assert.equal(wholeHead.status, 200);
  assertStaticHeaders(wholeHead);
  assert.equal(wholeHead.headers.get('content-length'), String(fixture.length));
  assert.equal((await responseBytes(wholeHead)).length, 0);

  const cases = [
    {
      name: 'bounded',
      header: 'bytes=5-15',
      start: 5,
      end: 15,
    },
    {
      name: 'open ended',
      header: 'bytes=20-',
      start: 20,
      end: fixture.length - 1,
    },
    {
      name: 'suffix',
      header: 'bytes=-13',
      start: fixture.length - 13,
      end: fixture.length - 1,
    },
    {
      name: 'oversized suffix',
      header: `bytes=-${fixture.length + 10}`,
      start: 0,
      end: fixture.length - 1,
    },
    {
      name: 'end clamped to file size',
      header: `bytes=${fixture.length - 3}-${fixture.length + 50}`,
      start: fixture.length - 3,
      end: fixture.length - 1,
    },
  ];

  for (const rangeCase of cases) {
    await t.test(`GET ${rangeCase.name}`, async () => {
      const response = await fetch(url, {
        headers: { Range: rangeCase.header },
      });
      const expected = fixture.subarray(rangeCase.start, rangeCase.end + 1);
      assert.equal(response.status, 206);
      assertStaticHeaders(response);
      assert.equal(
        response.headers.get('content-range'),
        `bytes ${rangeCase.start}-${rangeCase.end}/${fixture.length}`
      );
      assert.equal(response.headers.get('content-length'), String(expected.length));
      assert.deepEqual(await responseBytes(response), expected);
    });
  }

  const rangedHead = await fetch(url, {
    method: 'HEAD',
    headers: { Range: 'bytes=3-8' },
  });
  assert.equal(rangedHead.status, 206);
  assertStaticHeaders(rangedHead);
  assert.equal(
    rangedHead.headers.get('content-range'),
    `bytes 3-8/${fixture.length}`
  );
  assert.equal(rangedHead.headers.get('content-length'), '6');
  assert.equal((await responseBytes(rangedHead)).length, 0);

  const invalidRanges = [
    'bytes=-',
    'bytes=-0',
    'bytes=8-3',
    `bytes=${fixture.length}-`,
    'bytes=0-1,4-5',
    'items=0-1',
    'bytes=999999999999999999999-',
  ];

  for (const range of invalidRanges) {
    await t.test(`rejects ${range}`, async () => {
      const response = await fetch(url, { headers: { Range: range } });
      assert.equal(response.status, 416);
      assertStaticHeaders(response);
      assert.equal(
        response.headers.get('content-range'),
        `bytes */${fixture.length}`
      );
      assert.equal(response.headers.get('content-length'), '0');
      assert.equal((await responseBytes(response)).length, 0);
    });
  }

  const invalidHead = await fetch(url, {
    method: 'HEAD',
    headers: { Range: `bytes=${fixture.length}-` },
  });
  assert.equal(invalidHead.status, 416);
  assertStaticHeaders(invalidHead);
  assert.equal(
    invalidHead.headers.get('content-range'),
    `bytes */${fixture.length}`
  );
  assert.equal((await responseBytes(invalidHead)).length, 0);
});
