import test from 'node:test';
import assert from 'node:assert/strict';

import { createPinballState, PINBALL_DEFAULTS, stepPinball } from '../src/pinball-physics.js';

const makePegs = (width = 378, pocketTop = 131) => {
  const pegs = [];
  [5, 6, 5, 6, 5].forEach((count, row) => {
    const positions = count === 5
      ? [1, 2, 3, 4, 5].map((value) => value / 6)
      : [1, 3, 5, 7, 9, 11].map((value) => value / 12);
    positions.forEach((position) => pegs.push({
      x: position * width,
      y: (.1 + row * .18) * pocketTop,
      radius: 4.5,
    }));
  });
  return pegs;
};

test('gravity continuously accelerates the ball instead of interpolating a route', () => {
  const state = createPinballState({
    width: 200,
    height: 500,
    pocketTop: 400,
    pegs: [],
    random: () => .5,
  });
  state.vx = 0;

  stepPinball(state, .1);

  assert.equal(state.vy, 98);
  assert.ok(Math.abs(state.y - 1.8) < 1e-9);
});

test('peg contact reverses normal velocity and preserves tangential inertia', () => {
  const peg = { x: 100, y: 100, radius: 4.5 };
  const state = createPinballState({
    width: 200,
    height: 400,
    pocketTop: 350,
    pegs: [peg],
    random: () => .5,
  });
  state.x = 100;
  state.y = 87.6;
  state.vx = 45;
  state.vy = 120;

  const events = stepPinball(state, PINBALL_DEFAULTS.fixedStep);

  assert.ok(state.vy < -85, `expected an upward rebound, received ${state.vy}`);
  assert.ok(state.vx > 35, `expected tangential momentum to survive, received ${state.vx}`);
  assert.equal(events.impacts.length, 1);
  assert.equal(events.impacts[0].peg, peg);
});

test('a fixed-step run collides with the board and settles into a physical pocket', () => {
  let seed = 0x5eed;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const state = createPinballState({
    width: 378,
    height: 170,
    pocketTop: 131,
    pegs: makePegs(),
    random,
  });
  let impactCount = 0;

  while (!state.landed) {
    const events = stepPinball(state, PINBALL_DEFAULTS.fixedStep);
    impactCount += events.impacts.length;
  }

  assert.ok(impactCount >= 2);
  assert.ok(state.target >= 0 && state.target <= 5);
  assert.equal(state.x, (state.target + .5) * state.width / 6);
  assert.equal(state.y, state.height * .89);
  assert.ok(state.elapsed < 4.5, `run took too long: ${state.elapsed}s`);
});
