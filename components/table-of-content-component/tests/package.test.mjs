import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const expectedPublishedFiles = [
  "index.js",
  "index.d.ts",
  "table-of-content-model.js",
  "table-of-content.js",
  "README.md",
  "LICENSE",
  "NOTICE",
];

async function readRootFile(path) {
  return readFile(new URL(path, root), "utf8");
}

async function readPackage() {
  return JSON.parse(await readRootFile("package.json"));
}

function collectExportTargets(value, targets = []) {
  if (typeof value === "string") {
    targets.push(value);
  } else if (value && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      collectExportTargets(nestedValue, targets);
    }
  }
  return targets;
}

test("package metadata describes a public zero-runtime-dependency ESM package", async () => {
  const packageJson = await readPackage();

  assert.equal(packageJson.name, "table-of-content-component");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.main, "./index.js");
  assert.equal(packageJson.module, "./index.js");
  assert.equal(packageJson.browser, "./index.js");
  assert.equal(packageJson.types, "./index.d.ts");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.publishConfig?.access, "public");
  assert.equal(
    packageJson.repository?.url,
    "git+https://github.com/zanwei/table-of-content-component.git",
  );
  assert.equal(
    packageJson.homepage,
    "https://github.com/zanwei/table-of-content-component#readme",
  );
  assert.equal(
    packageJson.bugs?.url,
    "https://github.com/zanwei/table-of-content-component/issues",
  );
  assert.deepEqual(packageJson.dependencies ?? {}, {});
});

test("package exports resolve to the typed browser entry point", async () => {
  const packageJson = await readPackage();

  assert.deepEqual(packageJson.exports?.["."], {
    types: "./index.d.ts",
    browser: "./index.js",
    import: "./index.js",
    default: "./index.js",
  });
  assert.equal(packageJson.exports?.["./package.json"], "./package.json");

  const targets = new Set([
    packageJson.main,
    packageJson.module,
    packageJson.browser,
    packageJson.types,
    ...collectExportTargets(packageJson.exports),
  ]);

  for (const target of targets) {
    assert.equal(typeof target, "string");
    assert.match(target, /^\.\//, `package target must be relative: ${target}`);
    await access(new URL(target.slice(2), root));
  }
});

test("published files are explicit, complete, and exclude demo/reference assets", async () => {
  const packageJson = await readPackage();
  const publishedFiles = [...(packageJson.files ?? [])].sort();

  assert.deepEqual(publishedFiles, [...expectedPublishedFiles].sort());

  for (const file of expectedPublishedFiles) {
    await access(new URL(file, root));
  }

  for (const excluded of [
    "Area.mp4",
    "assets",
    "docs",
    "index.html",
    "tests",
  ]) {
    assert.ok(
      !publishedFiles.includes(excluded),
      `${excluded} must not be published`,
    );
  }

  assert.deepEqual([...(packageJson.sideEffects ?? [])].sort(), [
    "./index.js",
    "./table-of-content-model.js",
    "./table-of-content.js",
  ]);
});

test("package scripts run dependency-free tests and gate release archives", async () => {
  const packageJson = await readPackage();

  assert.equal(packageJson.scripts?.test, "node --test");
  assert.match(packageJson.scripts?.check ?? "", /npm test/);
  assert.match(packageJson.scripts?.check ?? "", /npm pack --dry-run/);
  assert.equal(packageJson.scripts?.prepublishOnly, "npm run check");
  assert.match(packageJson.scripts?.["pack:release"] ?? "", /^npm pack\b/);
});

test("entry point initializes the model before the custom element", async () => {
  const source = await readRootFile("index.js");

  const modelImport = source.indexOf('"./table-of-content-model.js"');
  const componentImport = source.indexOf('"./table-of-content.js"');

  assert.ok(modelImport >= 0, "index.js must import the model");
  assert.ok(componentImport >= 0, "index.js must import the component");
  assert.ok(
    modelImport < componentImport,
    "the model must initialize before the component",
  );
  assert.match(source, /\bexport\s+default\b/);
});

test("declarations cover data, events, the element class, and tag-name lookup", async () => {
  const declarations = await readRootFile("index.d.ts");

  for (const publicType of [
    "TableOfContentItemInput",
    "TableOfContentItem",
    "TableOfContentSelectOptions",
    "TableOfContentEventMap",
    "TableOfContent",
    "HTMLElementTagNameMap",
  ]) {
    assert.match(
      declarations,
      new RegExp(`\\b${publicType}\\b`),
      `${publicType} must be declared`,
    );
  }

  for (const eventName of ["toc-change", "toc-open", "toc-close"]) {
    assert.match(declarations, new RegExp(`["']${eventName}["']`));
  }

  assert.match(declarations, /["']table-of-content["']\s*:\s*TableOfContent/);
  assert.match(declarations, /\bexport\s+default\s+TableOfContent\b/);
});

test("license and notice clearly identify the grant and component", async () => {
  const [license, notice] = await Promise.all([
    readRootFile("LICENSE"),
    readRootFile("NOTICE"),
  ]);

  assert.match(license, /\bMIT License\b/);
  assert.match(license, /Permission is hereby granted/);
  assert.match(notice, /\bTable of Content\b/i);
  assert.ok(notice.trim().length > 40);
});
