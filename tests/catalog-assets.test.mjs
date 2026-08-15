import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const EXPECTED_ORDER = [
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

async function loadCatalog() {
  const source = await readFile(new URL('../catalog.js', import.meta.url), 'utf8');
  const context = {};
  runInNewContext(
    `${source}\nglobalThis.__catalog = CATALOG.map((item) => ({ ...item }));`,
    context
  );
  // Normalize values created in the VM back into this realm so strict
  // equality does not compare different Array/Object prototypes.
  return JSON.parse(JSON.stringify(context.__catalog));
}

function likeCards(source) {
  const body = source.match(/const LIKE_CARDS = new Set\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(body, 'LIKE_CARDS allowlist is present');
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('catalog order, media files, and like allowlists stay in sync', async () => {
  const catalog = await loadCatalog();
  const slugs = catalog.map((item) => item.slug);

  assert.deepEqual(slugs, EXPECTED_ORDER);
  assert.equal(new Set(slugs).size, slugs.length, 'catalog slugs are unique');

  for (const item of catalog) {
    const media =
      item.type === 'video'
        ? [item.previewVideo, item.video, item.poster]
        : item.image
          ? [item.image]
          : [];

    for (const relativePath of media) {
      assert.ok(relativePath, `${item.slug} declares every required media path`);
      const asset = new URL(`../${relativePath}`, import.meta.url);
      await access(asset);
      assert.ok((await stat(asset)).size > 0, `${relativePath} is not empty`);
    }
  }

  for (const relativePath of ['../presence.js', '../server.js', '../src/worker.js']) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.deepEqual(
      new Set(likeCards(source)),
      new Set(slugs),
      `${relativePath} accepts every catalog card`
    );
  }
});
