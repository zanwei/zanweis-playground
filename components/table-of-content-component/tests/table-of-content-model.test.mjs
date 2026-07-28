import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const modelSource = await readFile(
  new URL("../table-of-content-model.js", import.meta.url),
  "utf8",
);

function loadModel() {
  const context = vm.createContext({});
  vm.runInContext(modelSource, context, {
    filename: "table-of-content-model.js",
  });
  return { context, model: context.TableOfContentModel };
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("model registration is idempotent and exposes immutable defaults", () => {
  const { context, model } = loadModel();
  const original = model;

  vm.runInContext(modelSource, context, {
    filename: "table-of-content-model.js",
  });

  assert.strictEqual(context.TableOfContentModel, original);
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.GEOMETRY));
  assert.ok(Object.isFrozen(model.LIMITS));
  assert.ok(Object.isFrozen(model.MOTION));
  assert.ok(Object.isFrozen(model.DEFAULT_ITEMS));
  assert.ok(Object.isFrozen(model.DEFAULT_ITEMS[0]));
  assert.equal(model.DEFAULT_ITEMS.length, 38);
  assert.equal(model.LIMITS.maxItems, 200);
  assert.deepEqual(toPlain(model.DEFAULT_ITEMS[0]), {
    id: "content-1",
    title: "Content item 1",
    description: "Provide sections through the items property.",
  });
  assert.deepEqual(toPlain(model.DEFAULT_ITEMS[37]), {
    id: "content-38",
    title: "Content item 38",
    description: "Provide sections through the items property.",
  });
});

test("numeric helpers reject poisoned values and clamp deterministically", () => {
  const { model } = loadModel();

  assert.equal(model.finiteNumber("12.5", 0), 12.5);
  assert.equal(model.finiteNumber(null, 7), 7);
  assert.equal(model.finiteNumber(undefined, 7), 7);
  assert.equal(model.finiteNumber("", 7), 7);
  assert.equal(model.finiteNumber("not-a-number", 7), 7);
  assert.equal(model.finiteNumber(Number.NaN, 7), 7);
  assert.equal(model.finiteNumber(Number.POSITIVE_INFINITY, 7), 7);

  assert.equal(model.clamp(-2, 0, 10), 0);
  assert.equal(model.clamp(4, 0, 10), 4);
  assert.equal(model.clamp(12, 0, 10), 10);

  assert.equal(model.normalizeIndex(-4, 5), 0);
  assert.equal(model.normalizeIndex(2.49, 5), 2);
  assert.equal(model.normalizeIndex(2.5, 5), 3);
  assert.equal(model.normalizeIndex("3.6", 5), 4);
  assert.equal(model.normalizeIndex(99, 5), 4);
  assert.equal(model.normalizeIndex("invalid", 5, 2), 2);
  assert.equal(model.normalizeIndex(4, 0), 0);
  assert.equal(model.normalizeIndex(4, Number.NaN), 0);
});

test("item normalization is defensive, predictable, and text-only", () => {
  const { model } = loadModel();
  const input = [
    {
      id: " custom-id ",
      title: " First item ",
      description: 42,
    },
    null,
    {
      id: 0,
      title: 0,
      description: null,
    },
  ];
  const inputSnapshot = JSON.stringify(input);

  const normalized = model.normalizeItems(input);

  assert.equal(JSON.stringify(input), inputSnapshot, "input must not be mutated");
  assert.notStrictEqual(normalized, input);
  assert.deepEqual(toPlain(normalized), [
    {
      id: "custom-id",
      title: "First item",
      description: "42",
    },
    {
      id: "content-2",
      title: "Item 2",
      description: "",
    },
    {
      id: "0",
      title: "0",
      description: "",
    },
  ]);

  normalized[0].title = "Changed";
  assert.equal(input[0].title, " First item ");
  assert.deepEqual(toPlain(model.normalizeItems([{}])), [
    {
      id: "content-1",
      title: "Item 1",
      description: "",
    },
  ]);
  assert.deepEqual(toPlain(model.normalizeItems(new Array(2))), [
    {
      id: "content-1",
      title: "Item 1",
      description: "",
    },
    {
      id: "content-2",
      title: "Item 2",
      description: "",
    },
  ]);

  assert.throws(
    () => model.normalizeItems([]),
    /must be a non-empty array/,
  );
  assert.throws(
    () => model.normalizeItems(null),
    /must be a non-empty array/,
  );
  assert.throws(
    () => model.normalizeItems(Array.from({ length: 201 }, () => ({}))),
    /supports at most 200 items/,
  );
});

test("tick geometry reaches both track bounds without invalid arithmetic", () => {
  const { model } = loadModel();
  const { trackBottom, trackTop } = model.GEOMETRY;

  assert.equal(model.tickY(0, 38), trackTop);
  assert.equal(model.tickY(37, 38), trackBottom);
  assert.equal(model.tickY(-100, 38), trackTop);
  assert.equal(model.tickY(100, 38), trackBottom);
  assert.equal(model.tickY(0, 1), trackTop);
  assert.equal(model.tickY(0, 0), trackTop);

  for (let index = 0; index < 38; index += 1) {
    const position = model.tickY(index, 38);
    assert.ok(Number.isFinite(position));
    assert.ok(position >= trackTop && position <= trackBottom);
    if (index > 0) {
      assert.ok(position > model.tickY(index - 1, 38));
    }
  }
});

test("pointer selection clamps to the rail and maps its midpoint exactly", () => {
  const { model } = loadModel();
  const rectTop = 100;
  const rectHeight = 568;

  assert.equal(
    model.selectionFromPointer(200, rectTop, 0, 5),
    null,
  );
  assert.equal(
    model.selectionFromPointer(200, rectTop, -10, 5),
    null,
  );

  const above = model.selectionFromPointer(-100, rectTop, rectHeight, 5);
  const middle = model.selectionFromPointer(
    rectTop + rectHeight / 2,
    rectTop,
    rectHeight,
    5,
  );
  const below = model.selectionFromPointer(1000, rectTop, rectHeight, 5);

  assert.deepEqual(toPlain(above), {
    center: model.GEOMETRY.trackTop,
    floatIndex: 0,
    index: 0,
  });
  assert.deepEqual(toPlain(middle), {
    center:
      (model.GEOMETRY.trackTop + model.GEOMETRY.trackBottom) / 2,
    floatIndex: 2,
    index: 2,
  });
  assert.deepEqual(toPlain(below), {
    center: model.GEOMETRY.trackBottom,
    floatIndex: 4,
    index: 4,
  });
  assert.ok(Object.isFrozen(middle));

  const evenLengthMiddle = model.selectionFromPointer(
    rectTop + rectHeight / 2,
    rectTop,
    rectHeight,
    38,
  );
  assert.equal(evenLengthMiddle.floatIndex, 18.5);
  assert.equal(evenLengthMiddle.index, 19);
});

test("tick influence is centered, symmetric, and decreases with distance", () => {
  const { model } = loadModel();

  assert.equal(model.tickInfluence(4, null), 0);
  assert.equal(model.tickInfluence(4, undefined), 0);
  assert.equal(model.tickInfluence(4, 4), 1);
  assert.equal(model.tickInfluence(3, 4), model.tickInfluence(5, 4));
  assert.equal(model.tickInfluence(2, 4), model.tickInfluence(6, 4));
  assert.ok(model.tickInfluence(4, 4) > model.tickInfluence(5, 4));
  assert.ok(model.tickInfluence(5, 4) > model.tickInfluence(6, 4));
  assert.ok(model.tickInfluence(6, 4) > model.tickInfluence(10, 4));
  assert.ok(Number.isFinite(model.tickInfluence(Number.NaN, Number.NaN)));
});

test("spring integration is finite, partition-stable, and converges", () => {
  const { model } = loadModel();
  const {
    tickSpringDamping,
    tickSpringMaxStep,
    tickSpringStiffness,
  } = model.MOTION;
  const state = { value: 0, velocity: 0 };

  for (let frame = 0; frame < 240; frame += 1) {
    const returned = model.stepSpring(
      state,
      1,
      1 / 120,
      tickSpringStiffness,
      tickSpringDamping,
      tickSpringMaxStep,
    );
    assert.strictEqual(returned, state);
    assert.ok(Number.isFinite(state.value));
    assert.ok(Number.isFinite(state.velocity));
  }

  assert.ok(Math.abs(state.value - 1) < 1e-9);
  assert.ok(Math.abs(state.velocity) < 1e-9);

  const oneLargeStep = { value: 0, velocity: 0 };
  const partitioned = { value: 0, velocity: 0 };
  model.stepSpring(
    oneLargeStep,
    1,
    0.5,
    tickSpringStiffness,
    tickSpringDamping,
    tickSpringMaxStep,
  );
  for (let frame = 0; frame < 60; frame += 1) {
    model.stepSpring(
      partitioned,
      1,
      1 / 120,
      tickSpringStiffness,
      tickSpringDamping,
      tickSpringMaxStep,
    );
  }

  assert.ok(Math.abs(oneLargeStep.value - partitioned.value) < 1e-12);
  assert.ok(Math.abs(oneLargeStep.velocity - partitioned.velocity) < 1e-12);

  const poisoned = { value: Number.NaN, velocity: Number.POSITIVE_INFINITY };
  model.stepSpring(
    poisoned,
    Number.NaN,
    10,
    Number.NaN,
    -1,
    0,
  );
  assert.ok(Number.isFinite(poisoned.value));
  assert.ok(Number.isFinite(poisoned.velocity));
});
