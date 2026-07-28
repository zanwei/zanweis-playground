import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlinkoRoute } from '../src/plinko-route.js';

const randomFor = (decisions) => {
  let cursor = 0;
  return () => decisions[cursor++] ? .75 : .25;
};

test('five left/right decisions produce the six binomial result weights', () => {
  const counts = Array(6).fill(0);

  for (let mask = 0; mask < 32; mask += 1) {
    const decisions = Array.from({ length: 5 }, (_, bit) => Boolean(mask & (1 << bit)));
    const route = createPlinkoRoute(randomFor(decisions));
    counts[route.result] += 1;
  }

  assert.deepEqual(counts, [1, 5, 10, 10, 5, 1]);
});

test('route endpoints and result indexes stay causally aligned', () => {
  const allLeft = createPlinkoRoute(() => 0);
  const allRight = createPlinkoRoute(() => 1);
  const medium = createPlinkoRoute(randomFor([true, true, false, false, false]));

  assert.deepEqual(
    [allLeft.result, medium.result, allRight.result],
    [0, 2, 5],
  );
  assert.deepEqual(
    [allLeft.points.at(-1).x, medium.points.at(-1).x, allRight.points.at(-1).x],
    [8.333, 41.667, 91.667],
  );
});

test('consecutive runs are allowed to repeat the same stop', () => {
  const first = createPlinkoRoute(() => 1);
  const second = createPlinkoRoute(() => 1);

  assert.equal(first.result, 5);
  assert.equal(second.result, first.result);
});
