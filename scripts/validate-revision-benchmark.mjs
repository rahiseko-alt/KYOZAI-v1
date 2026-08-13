import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const source = path.resolve("shared/fixtures/revision-benchmark/benchmark.json");
const benchmark = JSON.parse(await readFile(source, "utf8"));
const schemaFiles = [
  "revision-request.schema.json",
  "revision-plan.schema.json",
  "revision-validation.schema.json",
];
const expectedCategories = new Set([
  "proper-noun-and-typo",
  "shorten-audience-tone",
  "image-and-local-layout",
  "add-remove-move",
  "source-correction-and-deck-design",
]);
const allowedOperations = new Set([
  "text.replace",
  "text.rewrite",
  "visual.replace-image",
  "visual.relayout-slide",
  "visual.restyle-deck",
  "slide.add",
  "slide.remove",
  "slide.move",
  "source.correct",
  "version.restore",
]);

function fail(message) {
  throw new Error(`${source}: ${message}`);
}

if (!Array.isArray(benchmark.categories) || benchmark.categories.length !== 5) {
  fail("exactly five categories are required");
}

const ids = new Set();
const cases = [];
for (const category of benchmark.categories) {
  if (!expectedCategories.has(category.id)) fail(`unexpected category ${category.id}`);
  if (!Array.isArray(category.cases) || category.cases.length !== 10) {
    fail(`${category.id} must contain exactly ten cases`);
  }
  for (const entry of category.cases) {
    for (const field of ["id", "instruction", "operation", "scope", "must_preserve", "expected_assertions", "stability"]) {
      if (entry[field] === undefined || entry[field] === null) fail(`${entry.id ?? "unknown"} is missing ${field}`);
    }
    if (ids.has(entry.id)) fail(`duplicate case id ${entry.id}`);
    if (!allowedOperations.has(entry.operation)) fail(`${entry.id} has unsupported operation ${entry.operation}`);
    if (!Array.isArray(entry.scope.fields) || entry.scope.fields.length === 0) fail(`${entry.id} has no scoped fields`);
    if (!Array.isArray(entry.must_preserve) || entry.must_preserve.length === 0) fail(`${entry.id} has no invariants`);
    if (!Array.isArray(entry.expected_assertions) || entry.expected_assertions.length === 0) fail(`${entry.id} has no assertions`);
    if (!new Set(["strict", "bounded"]).has(entry.stability)) fail(`${entry.id} has invalid stability`);
    ids.add(entry.id);
    cases.push(entry);
  }
}

if (cases.length !== 50) fail(`expected 50 cases, found ${cases.length}`);

const strict = cases.filter((entry) => entry.stability === "strict").length;
const bounded = cases.length - strict;
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
for (const file of schemaFiles) {
  const schemaPath = path.resolve("shared/schemas", file);
  ajv.compile(JSON.parse(await readFile(schemaPath, "utf8")));
}

console.log(`Validated ${schemaFiles.length} revision schemas and ${cases.length} cases across ${benchmark.categories.length} categories (${strict} strict, ${bounded} bounded).`);
