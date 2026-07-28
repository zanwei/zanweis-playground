import assert from "node:assert/strict";
import test from "node:test";

await import("../liquid-path.js");

const {
  DEFAULT_PEEL_PARAMETERS,
  LIQUID_GEOMETRY,
  LIQUID_MOTION,
  PEEL_PARAMETER_LIMITS,
  closeAgeForGap,
  createLiquidFrame,
  easedPeelAge,
  finiteNumber,
  normalizePeelParameters,
  resolveLiquidMode,
  resolveScrubMode,
  sampleMeasuredTransition,
  smoothstep,
  smootherstep,
} = globalThis.LiquidPath;

const EPSILON = 1e-6;

function subpathCount(path) {
  return path.match(/\bM(?:\s|$)/g)?.length ?? 0;
}

function commandCount(path, command) {
  return path.match(new RegExp(`\\b${command}(?:\\s|$)`, "g"))
    ?.length ?? 0;
}

function assertClose(actual, expected, tolerance = 0.001, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `${actual} is not within ${tolerance} of ${expected}`,
  );
}

function assertFinitePath(path, label = "path") {
  assert.equal(typeof path, "string", `${label} must be a string`);
  assert.ok(path.length > 0, `${label} must not be empty`);
  assert.doesNotMatch(path, /NaN|Infinity|undefined|null/i, label);
}

function assertFiniteFrame(frame, label = "frame") {
  for (const key of [
    "faceGap",
    "gap",
    "inputBottom",
    "inputContentHeight",
    "inputContentScaleY",
    "inputContentY",
    "inputFaceRx",
    "inputFaceRy",
    "inputHeight",
    "inputVisualHeight",
    "inputVisualY",
    "inputY",
    "notch",
    "outputBlur",
    "outputFaceRx",
    "outputFaceRy",
    "outputHeight",
    "outputOpacity",
    "outputScaleY",
    "outputSmear",
    "outputY",
    "sendArrowScaleY",
    "sendHeight",
    "sendOffsetY",
    "sendRadiusY",
    "sendScaleY",
    "strain",
    "stretch",
    "waistWidth",
  ]) {
    assert.ok(Number.isFinite(frame[key]), `${label}.${key} must be finite`);
  }

  assertFinitePath(frame.d, `${label}.d`);
  assertFinitePath(frame.edgeD, `${label}.edgeD`);

  if (frame.debug) {
    for (const key of [
      "actualD",
      "outputD",
      "inputD",
      "contactZoneD",
      "contactBandD",
      "waistD",
    ]) {
      const path = frame.debug[key];
      assert.equal(typeof path, "string", `${label}.debug.${key}`);
      assert.doesNotMatch(
        path,
        /NaN|Infinity|undefined|null/i,
        `${label}.debug.${key}`,
      );
    }
  }
}

test("numeric helpers clamp smoothly and reject poisoned input", () => {
  assert.equal(smoothstep(0, 1, -1), 0);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.ok(smoothstep(0, 1, 0.25) < smoothstep(0, 1, 0.75));
  assert.equal(smootherstep(0, 1, -1), 0);
  assert.equal(smootherstep(0, 1, 2), 1);
  assert.ok(smootherstep(0, 1, 0.25) < smootherstep(0, 1, 0.75));

  assert.equal(finiteNumber("12.5", 0), 12.5);
  assert.equal(finiteNumber(null, 7), 7);
  assert.equal(finiteNumber("", 7), 7);
  assert.equal(finiteNumber("not-a-number", 7), 7);
  assert.equal(finiteNumber(Infinity, 7), 7);
  assert.equal(createLiquidFrame("not-a-number").gap, -54);
});

test("peel parameters expose stable defaults and normalize every field", () => {
  assert.deepEqual(DEFAULT_PEEL_PARAMETERS, {
    detachGap: 6,
    transition: 6.5,
    couplingRadius: 5,
    pull: 2.5,
  });

  const defaults = normalizePeelParameters();
  assert.deepEqual(defaults, {
    ...DEFAULT_PEEL_PARAMETERS,
    peelStart: -0.5,
  });
  assert.ok(Object.isFrozen(defaults));

  const normalized = normalizePeelParameters({
    detachGap: -100,
    transition: Number.NaN,
    couplingRadius: 100,
    pull: -100,
  });
  assert.equal(normalized.detachGap, PEEL_PARAMETER_LIMITS.detachGap.min);
  assert.equal(normalized.transition, DEFAULT_PEEL_PARAMETERS.transition);
  assert.equal(
    normalized.couplingRadius,
    PEEL_PARAMETER_LIMITS.couplingRadius.max,
  );
  assert.equal(normalized.pull, PEEL_PARAMETER_LIMITS.pull.min);
  assert.equal(normalized.peelStart, -0.5);

  const frame = createLiquidFrame(4, 0, {
    peelParameters: {
      detachGap: 6,
      transition: Number.NaN,
      couplingRadius: 5,
      pull: 2.5,
      peelStart: -0.5,
      // Older normalized objects exposed this now-removed derived field.
      bridgeStart: 3.66,
    },
  });
  assert.deepEqual(frame.peelParameters, defaults);
  assert.ok(Object.isFrozen(frame.peelParameters));
  assertFiniteFrame(frame);
});

test("topology changes only after the 6px detach threshold", () => {
  assert.equal(resolveLiquidMode(undefined, 6), "merged");
  assert.equal(resolveLiquidMode(undefined, 6 + EPSILON), "detached");
  assert.equal(resolveLiquidMode("merged", 6), "merged");
  assert.equal(resolveLiquidMode("merged", 6 + EPSILON), "detached");

  // Closing uses directional hysteresis: a detached card does not rejoin at
  // the same threshold, and negative velocity advances the merge point.
  assert.equal(resolveLiquidMode("detached", 0), "detached");
  assert.equal(resolveLiquidMode("detached", -EPSILON), "merged");
  assert.equal(resolveLiquidMode("detached", 2, -500), "merged");
  assert.equal(resolveLiquidMode("detached", 2.2, -500), "detached");

  assert.equal(subpathCount(createLiquidFrame(6).d), 1);
  assert.equal(subpathCount(createLiquidFrame(6 + EPSILON).d), 2);

  const custom = normalizePeelParameters({ detachGap: 9 });
  assert.equal(resolveLiquidMode("merged", 9, 0, custom), "merged");
  assert.equal(
    resolveLiquidMode("merged", 9 + EPSILON, 0, custom),
    "detached",
  );
});

test("manual peel keeps the output card dimensions and round corners fixed", () => {
  const peel = normalizePeelParameters();
  const expectedStartX = LIQUID_GEOMETRY.x + LIQUID_GEOMETRY.outputRadius;
  const expectedEndX =
    LIQUID_GEOMETRY.x +
    LIQUID_GEOMETRY.width -
    LIQUID_GEOMETRY.outputRadius;

  for (
    let gap = peel.peelStart;
    gap <= peel.detachGap + EPSILON;
    gap += 0.25
  ) {
    const frame = createLiquidFrame(gap, 0, {
      mode: "merged",
      scrub: true,
    });
    const topEdge = frame.d.match(
      /^M (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) H (-?\d+(?:\.\d+)?)/,
    );

    assert.ok(topEdge, `top edge must remain explicit at gap ${gap}`);
    assert.equal(frame.outputHeight, LIQUID_GEOMETRY.outputHeight);
    assert.equal(frame.outputFaceRx, LIQUID_GEOMETRY.outputRadius);
    assert.equal(frame.outputFaceRy, LIQUID_GEOMETRY.outputRadius);
    assert.equal(frame.inputFaceRx, LIQUID_GEOMETRY.inputRadius);
    assert.equal(frame.inputFaceRy, LIQUID_GEOMETRY.inputRadius);
    assertClose(Number(topEdge[1]), expectedStartX);
    assertClose(Number(topEdge[3]), expectedEndX);
  }
});

test("merged debug geometry reveals the three tangent circles per side", () => {
  const parameters = normalizePeelParameters({ couplingRadius: 12 });
  const frame = createLiquidFrame(parameters.detachGap, 0, {
    mode: "merged",
    scrub: true,
    debug: true,
    peelParameters: parameters,
  });

  assert.equal(frame.debug.actualD, frame.d);
  assert.equal(frame.debug.topology, "merged");
  assert.equal(frame.debug.phase, "neck");
  assert.equal(subpathCount(frame.d), 1);
  assert.equal(commandCount(frame.d, "A"), 6);

  // Two output corner circles, two input corner circles, and two red
  // coupling circles are exposed separately for visual inspection.
  assert.equal(subpathCount(frame.debug.outputD), 2);
  assert.equal(commandCount(frame.debug.outputD, "A"), 4);
  assert.equal(subpathCount(frame.debug.inputD), 2);
  assert.equal(commandCount(frame.debug.inputD, "A"), 4);
  assert.equal(subpathCount(frame.debug.contactZoneD), 2);
  assert.equal(commandCount(frame.debug.contactZoneD, "A"), 4);
  assert.match(frame.debug.contactZoneD, /\bA 12 12\b/);
  assert.equal(subpathCount(frame.debug.waistD), 1);
  assert.equal(commandCount(frame.debug.waistD, "H"), 1);
  assert.ok(frame.waistWidth > 0);
});

test("detachment swaps topology without distorting either card", () => {
  const merged = createLiquidFrame(6, 0, {
    mode: "merged",
    scrub: true,
    debug: true,
  });
  const detached = createLiquidFrame(6 + 0.001, 0, {
    mode: "detached",
    scrub: true,
    debug: true,
  });

  assert.equal(subpathCount(merged.d), 1);
  assert.equal(subpathCount(detached.d), 2);
  assert.equal(commandCount(detached.d, "Z"), 2);
  assert.equal(detached.debug.topology, "detached");
  assert.equal(detached.debug.phase, "detached");
  assert.equal(detached.debug.contactKind, "none");
  assert.equal(detached.debug.contactZoneD, "");
  assert.equal(detached.debug.contactBandD, "");
  assert.equal(detached.debug.waistD, "");

  for (const frame of [merged, detached]) {
    assert.equal(frame.outputHeight, LIQUID_GEOMETRY.outputHeight);
    assert.equal(frame.outputFaceRx, LIQUID_GEOMETRY.outputRadius);
    assert.equal(frame.outputFaceRy, LIQUID_GEOMETRY.outputRadius);
    assert.equal(frame.inputFaceRx, LIQUID_GEOMETRY.inputRadius);
    assert.equal(frame.inputFaceRy, LIQUID_GEOMETRY.inputRadius);
  }

  assertClose(detached.outputY, merged.outputY, 0.01);
  assertClose(detached.inputY, merged.inputY, 0.01);
  assertClose(detached.inputBottom, merged.inputBottom, 0.01);
});

test("all public paths remain finite across gaps, velocities, and limits", () => {
  const parameterSets = [
    normalizePeelParameters(),
    normalizePeelParameters({
      detachGap: PEEL_PARAMETER_LIMITS.detachGap.min,
      transition: PEEL_PARAMETER_LIMITS.transition.min,
      couplingRadius: PEEL_PARAMETER_LIMITS.couplingRadius.min,
      pull: PEEL_PARAMETER_LIMITS.pull.min,
    }),
    normalizePeelParameters({
      detachGap: PEEL_PARAMETER_LIMITS.detachGap.max,
      transition: PEEL_PARAMETER_LIMITS.transition.max,
      couplingRadius: PEEL_PARAMETER_LIMITS.couplingRadius.max,
      pull: PEEL_PARAMETER_LIMITS.pull.max,
    }),
  ];

  for (const parameters of parameterSets) {
    for (let gap = -72; gap <= 24; gap += 1) {
      for (const mode of ["merged", "detached"]) {
        const frame = createLiquidFrame(gap, gap * 24, {
          mode,
          scrub: true,
          debug: true,
          openAge: 0.09,
          openStrength: 1,
          tearAge: 0.023,
          tearStrength: 1,
          peelParameters: parameters,
        });
        assertFiniteFrame(frame, `${mode} gap=${gap}`);
      }
    }
  }
});

test("measured opening and closing transitions preserve their endpoints", () => {
  const openingStart = sampleMeasuredTransition("opening", 0);
  const openingBridge = sampleMeasuredTransition(
    "opening",
    LIQUID_MOTION.openBridgeStart,
  );
  const openingEnd = sampleMeasuredTransition("opening", 10);
  const closingStart = sampleMeasuredTransition("closing", 0);
  const closingEnd = sampleMeasuredTransition("closing", 10);

  assert.equal(openingStart.done, false);
  assert.equal(openingStart.gap, LIQUID_GEOMETRY.hiddenGap);
  assertClose(openingBridge.gap, 6, 0.001);
  assert.deepEqual(openingEnd, {
    done: true,
    gap: LIQUID_GEOMETRY.restGap,
    velocity: 0,
  });
  assert.equal(closingStart.gap, LIQUID_GEOMETRY.restGap);
  assert.deepEqual(closingEnd, {
    done: true,
    gap: LIQUID_GEOMETRY.hiddenGap,
    velocity: 0,
  });

  for (const gap of [10, 2, -16, -36, -50, -58, -60]) {
    const age = closeAgeForGap(gap);
    const sampled = sampleMeasuredTransition("closing", age);
    assertClose(sampled.gap, gap, 0.01, `closing inversion at ${gap}px`);
  }

  assert.equal(resolveScrubMode("merged", 6), "merged");
  assert.equal(resolveScrubMode("merged", 6 + EPSILON), "detached");
});

test("closing scrub stretches text and changes the button's real height", () => {
  const rest = createLiquidFrame(10, 0, {
    mode: "detached",
    scrub: true,
  });
  const strained = createLiquidFrame(2, 0, {
    mode: "merged",
    scrub: true,
  });
  const settled = createLiquidFrame(-50, 0, {
    mode: "merged",
    scrub: true,
  });

  assert.equal(rest.inputContentScaleY, 1);
  assert.equal(rest.sendHeight, LIQUID_GEOMETRY.sendSize);
  assert.ok(strained.inputContentScaleY >= 1.2);
  assert.ok(strained.sendHeight > LIQUID_GEOMETRY.sendSize);
  assertClose(
    strained.sendHeight,
    LIQUID_GEOMETRY.sendSize * strained.sendScaleY,
    EPSILON,
  );
  assertClose(
    strained.sendArrowScaleY,
    1 / strained.inputContentScaleY,
    EPSILON,
  );
  assert.ok(strained.sendRadiusY < strained.sendHeight / 2);
  assertClose(settled.inputContentScaleY, 1, EPSILON);
  assertClose(settled.sendHeight, LIQUID_GEOMETRY.sendSize, EPSILON);
});

test("eased peel time starts gently and rejoins real time continuously", () => {
  const duration = LIQUID_MOTION.peelEaseDuration;
  assert.equal(easedPeelAge(-1), 0);
  assert.equal(easedPeelAge(0), 0);
  assert.ok(easedPeelAge(duration / 2) < duration / 2);
  assertClose(easedPeelAge(duration), duration, EPSILON);
  assert.equal(easedPeelAge(duration * 2), duration * 2);

  const step = 1e-6;
  const velocityAtJoin =
    (easedPeelAge(duration) - easedPeelAge(duration - step)) / step;
  assertClose(velocityAtJoin, 1, 0.001);
});

test("debug output is opt-in and white-surface geometry is path-based", () => {
  const normal = createLiquidFrame(4, 0, { mode: "merged" });
  const debug = createLiquidFrame(4, 0, {
    mode: "merged",
    debug: true,
  });

  assert.equal(normal.debug, null);
  assert.equal(debug.edgeD, debug.d);
  assert.match(debug.d, /\bA\b/);
  assert.doesNotMatch(debug.d, /filter|mask|url\(/i);
});
