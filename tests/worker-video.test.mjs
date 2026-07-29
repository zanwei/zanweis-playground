import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function importWorker() {
  const source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  const testableSource = source.replace(
    "import { WorkerEntrypoint } from 'cloudflare:workers';",
    'class WorkerEntrypoint {}'
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`;
  return import(moduleUrl);
}

test('video entrypoint returns a cacheable full response', async () => {
  const { VideoAsset } = await importWorker();
  const videoAsset = new VideoAsset();
  videoAsset.env = {
    ASSETS: {
      fetch: async () =>
        new Response('webm', {
          headers: {
            'Content-Type': 'video/webm',
            ETag: '"asset-etag"',
          },
        }),
    },
  };

  const response = await videoAsset.fetch(
    new Request('https://example.com/assets/video/bridge-card-v1.webm')
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(
    response.headers.get('Cache-Control'),
    'public, max-age=31536000, immutable'
  );
  assert.equal(
    response.headers.get('Cloudflare-CDN-Cache-Control'),
    'public, max-age=31536000, immutable'
  );
  assert.equal(response.headers.get('ETag'), '"asset-etag"');
});

test('uncached gateway restores Accept-Ranges after Workers Cache slicing', async () => {
  const { default: worker } = await importWorker();
  const request = new Request(
    'https://example.com/assets/video/bridge-card-v1.webm',
    { headers: { Range: 'bytes=0-1023' } }
  );
  const ctx = {
    exports: {
      VideoAsset: {
        fetch: async () =>
          new Response('slice', {
            status: 206,
            headers: {
              'Content-Range': 'bytes 0-4/10',
              ETag: '"asset-etag"',
            },
          }),
      },
    },
  };

  const response = await worker.fetch(request, {}, ctx);

  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-4/10');
  assert.equal(response.headers.get('ETag'), '"asset-etag"');
});
