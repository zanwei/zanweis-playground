const DEFAULTS = Object.freeze({
  ballRadius: 8,
  gravity: 680,
  pegRestitution: .76,
  wallRestitution: .7,
  tangentRetention: .985,
  pocketRestitution: .3,
  pocketSpring: 150,
  pocketDamping: 18,
  fixedStep: 1 / 240,
  maxPlayTime: 3.5,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function createPinballState({
  width,
  height,
  pocketTop,
  pegs,
  random = Math.random,
  options = {},
}) {
  const config = { ...DEFAULTS, ...options };
  const jitter = (random() - .5) * 4.4;
  const launchSample = random() - .5;
  const launchVelocity = Math.sign(launchSample || 1) * (16 + Math.abs(launchSample) * 28);

  return {
    ...config,
    width,
    height,
    pocketTop,
    pegs,
    x: width / 2 + jitter,
    y: -config.ballRadius,
    vx: launchVelocity,
    vy: 30,
    elapsed: 0,
    captureElapsed: 0,
    accumulator: 0,
    mode: 'play',
    target: null,
    targetX: null,
    targetY: height * .89,
    floorHits: 0,
    verticalSleeping: false,
    landed: false,
    lastImpactAt: Array(pegs.length).fill(-Infinity),
  };
}

export function stepPinball(state, deltaSeconds) {
  if (state.landed) return { landed: true, impacts: [], floorImpact: false };

  state.elapsed += deltaSeconds;
  const impacts = [];
  let floorImpact = false;

  if (state.mode === 'play') {
    state.vy += state.gravity * deltaSeconds;
    state.x += state.vx * deltaSeconds;
    state.y += state.vy * deltaSeconds;

    resolveSideWalls(state);
    resolvePegs(state, impacts);

    if (state.y >= state.pocketTop || state.elapsed >= state.maxPlayTime) {
      beginPocketCapture(state);
    }
  } else {
    state.captureElapsed += deltaSeconds;
    const horizontalAcceleration =
      (state.targetX - state.x) * state.pocketSpring - state.vx * state.pocketDamping;
    state.vx += horizontalAcceleration * deltaSeconds;
    state.x += state.vx * deltaSeconds;

    const slotWidth = state.width / 6;
    const left = state.target * slotWidth + state.ballRadius;
    const right = (state.target + 1) * slotWidth - state.ballRadius;
    if (state.x < left) {
      state.x = left;
      if (state.vx < 0) state.vx *= -state.wallRestitution;
    } else if (state.x > right) {
      state.x = right;
      if (state.vx > 0) state.vx *= -state.wallRestitution;
    }

    if (!state.verticalSleeping) {
      state.vy += state.gravity * deltaSeconds;
      state.y += state.vy * deltaSeconds;

      if (state.y >= state.targetY && state.vy > 0) {
        const incomingSpeed = state.vy;
        state.y = state.targetY;
        state.vy = -incomingSpeed * state.pocketRestitution;
        state.vx *= .82;
        state.floorHits += 1;
        floorImpact = true;

        if (state.floorHits >= 2 || incomingSpeed < 90) {
          state.vy = 0;
          state.verticalSleeping = true;
        }
      }
    }

    const horizontallySettled = Math.abs(state.targetX - state.x) < .7 && Math.abs(state.vx) < 7;
    if ((state.verticalSleeping && horizontallySettled) || state.captureElapsed >= .9) {
      state.x = state.targetX;
      state.y = state.targetY;
      state.vx = 0;
      state.vy = 0;
      state.landed = true;
    }
  }

  return { landed: state.landed, impacts, floorImpact };
}

function resolveSideWalls(state) {
  if (state.x < state.ballRadius) {
    state.x = state.ballRadius;
    if (state.vx < 0) state.vx *= -state.wallRestitution;
  } else if (state.x > state.width - state.ballRadius) {
    state.x = state.width - state.ballRadius;
    if (state.vx > 0) state.vx *= -state.wallRestitution;
  }
}

function resolvePegs(state, impacts) {
  for (let pass = 0; pass < 2; pass += 1) {
    state.pegs.forEach((peg, index) => {
      const dx = state.x - peg.x;
      const dy = state.y - peg.y;
      const minimumDistance = state.ballRadius + peg.radius;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= minimumDistance * minimumDistance) return;

      const distance = Math.sqrt(distanceSquared) || minimumDistance;
      const nx = distanceSquared === 0 ? 0 : dx / distance;
      const ny = distanceSquared === 0 ? -1 : dy / distance;
      const overlap = minimumDistance - distance;
      state.x += nx * overlap;
      state.y += ny * overlap;

      const normalVelocity = state.vx * nx + state.vy * ny;
      if (normalVelocity >= 0) return;

      const tangentX = -ny;
      const tangentY = nx;
      const tangentVelocity = state.vx * tangentX + state.vy * tangentY;
      const reboundVelocity = -normalVelocity * state.pegRestitution;
      const retainedTangentVelocity = tangentVelocity * state.tangentRetention;
      state.vx = reboundVelocity * nx + retainedTangentVelocity * tangentX;
      state.vy = reboundVelocity * ny + retainedTangentVelocity * tangentY;

      if (state.elapsed - state.lastImpactAt[index] >= .075 && -normalVelocity >= 24) {
        state.lastImpactAt[index] = state.elapsed;
        impacts.push({
          peg,
          index,
          x: peg.x + nx * peg.radius,
          y: peg.y + ny * peg.radius,
          nx,
          ny,
          speed: -normalVelocity,
        });
      }
    });
  }
}

function beginPocketCapture(state) {
  const slotWidth = state.width / 6;
  state.target = clamp(Math.floor(state.x / slotWidth), 0, 5);
  state.targetX = (state.target + .5) * slotWidth;
  state.mode = 'pocket';
}

export { DEFAULTS as PINBALL_DEFAULTS };
