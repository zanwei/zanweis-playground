import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [modelSource, componentSource] = await Promise.all([
  readFile(new URL("../table-of-content-model.js", import.meta.url), "utf8"),
  readFile(new URL("../table-of-content.js", import.meta.url), "utf8"),
]);

function createRegistry(initialEntries = []) {
  const definitions = new Map(initialEntries);
  let defineCalls = 0;

  return {
    customElements: {
      define(name, constructor) {
        defineCalls += 1;
        if (definitions.has(name)) {
          throw new Error(`Custom element already defined: ${name}`);
        }
        definitions.set(name, constructor);
      },
      get(name) {
        return definitions.get(name);
      },
    },
    get defineCalls() {
      return defineCalls;
    },
  };
}

function createBrowserContext({ initialEntries = [], withModel = true } = {}) {
  const registry = createRegistry(initialEntries);
  const template = {
    content: {
      cloneNode() {
        return {};
      },
    },
    innerHTML: "",
  };
  const document = {
    createElement(name) {
      assert.equal(name, "template");
      return template;
    },
  };
  class HTMLElement {}

  const context = vm.createContext({
    customElements: registry.customElements,
    document,
    HTMLElement,
  });

  if (withModel) {
    vm.runInContext(modelSource, context, {
      filename: "table-of-content-model.js",
    });
  }

  return { context, registry };
}

function evaluateComponent(context) {
  vm.runInContext(componentSource, context, {
    filename: "table-of-content.js",
  });
}

test("component registers once and exposes the registered constructor", () => {
  const { context, registry } = createBrowserContext();

  evaluateComponent(context);

  const registered = registry.customElements.get("table-of-content");
  assert.equal(typeof registered, "function");
  assert.strictEqual(context.TableOfContent, registered);
  assert.equal(registry.defineCalls, 1);
  assert.deepEqual(Array.from(registered.observedAttributes), [
    "label",
    "value",
    "open",
  ]);

  const prototype = registered.prototype;
  for (const property of ["items", "value", "open", "label"]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    assert.equal(typeof descriptor?.get, "function", `${property} getter`);
    assert.equal(typeof descriptor?.set, "function", `${property} setter`);
  }
  assert.equal(typeof prototype.select, "function");
  assert.equal(typeof prototype.close, "function");
});

test("evaluating the component twice keeps constructor identity stable", () => {
  const { context, registry } = createBrowserContext();

  evaluateComponent(context);
  const firstConstructor = registry.customElements.get("table-of-content");
  evaluateComponent(context);

  assert.equal(registry.defineCalls, 1);
  assert.strictEqual(
    registry.customElements.get("table-of-content"),
    firstConstructor,
  );
  assert.strictEqual(context.TableOfContent, firstConstructor);
});

test("an existing compatible tag is reused without a second definition", () => {
  class ExistingTableOfContent {}
  const { context, registry } = createBrowserContext({
    initialEntries: [["table-of-content", ExistingTableOfContent]],
  });

  evaluateComponent(context);

  assert.equal(registry.defineCalls, 0);
  assert.strictEqual(
    registry.customElements.get("table-of-content"),
    ExistingTableOfContent,
  );
  assert.strictEqual(context.TableOfContent, ExistingTableOfContent);
});

test("component fails clearly when its model script was not loaded", () => {
  const { context, registry } = createBrowserContext({ withModel: false });

  assert.throws(
    () => evaluateComponent(context),
    /requires table-of-content-model\.js to be loaded first/,
  );
  assert.equal(registry.defineCalls, 0);
  assert.equal(registry.customElements.get("table-of-content"), undefined);
});

test("component script is a safe no-op outside a browser-like environment", () => {
  const context = vm.createContext({});

  assert.doesNotThrow(() => evaluateComponent(context));
  assert.equal(context.TableOfContent, undefined);
});
