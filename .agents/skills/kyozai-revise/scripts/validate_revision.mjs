#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_VERSION = "kyozai-revise-validation@0.1.0";
const MUTABLE_SLIDE_FIELDS = new Set([
  "theme",
  "role",
  "layoutFamily",
  "labels",
  "title",
  "keyMessage",
  "bullets",
  "speakerNotes",
  "scriptCharacters",
  "durationSeconds",
]);
const DISPLAY_TEXT_FIELDS = new Set(["theme", "labels", "title", "keyMessage", "bullets"]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sameValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function parseArguments(argv) {
  const options = {};
  const aliases = { "--before": "before", "--before-deck": "before", "--after": "after", "--after-deck": "after", "--plan": "plan", "--revision-plan": "plan" };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--pretty") {
      options.pretty = true;
      continue;
    }
    const key = aliases[argument];
    if (!key || !argv[index + 1]) throw new Error("Usage: validate_revision.mjs --before before-deck.json --after after-deck.json --plan revision-plan.json [--pretty]");
    if (options[key]) throw new Error(`Duplicate argument: ${argument}`);
    options[key] = argv[index + 1];
    index += 1;
  }

  if (!options.before || !options.after || !options.plan) {
    throw new Error("Usage: validate_revision.mjs --before before-deck.json --after after-deck.json --plan revision-plan.json [--pretty]");
  }
  return options;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function validateDeck(deck, label) {
  requireObject(deck, label);
  if (!Array.isArray(deck.slides)) throw new Error(`${label}.slides must be an array`);

  const slideByNumber = new Map();
  for (const slide of deck.slides) {
    requireObject(slide, `${label}.slides[]`);
    if (!Number.isInteger(slide.number) || slide.number < 1) throw new Error(`${label}.slides[].number must be a positive integer`);
    if (slideByNumber.has(slide.number)) throw new Error(`${label}.slides contains duplicate slide number ${slide.number}`);
    slideByNumber.set(slide.number, slide);
  }
  return slideByNumber;
}

function normalizeFieldList(value, label) {
  if (!Array.isArray(value) || value.some((field) => typeof field !== "string" || !MUTABLE_SLIDE_FIELDS.has(field))) {
    throw new Error(`${label} must be an array of supported slide fields`);
  }
  return [...new Set(value)].sort();
}

function normalizePlan(plan, beforeSlides) {
  requireObject(plan, "revision plan");
  if (!Array.isArray(plan.targetSlides) || plan.targetSlides.length === 0 || plan.targetSlides.some((number) => !Number.isInteger(number) || number < 1)) {
    throw new Error("revision plan.targetSlides must be a non-empty array of positive integers");
  }
  const targetSlides = [...new Set(plan.targetSlides)].sort((left, right) => left - right);
  if (targetSlides.length !== plan.targetSlides.length) throw new Error("revision plan.targetSlides must not contain duplicates");
  for (const number of targetSlides) {
    if (!beforeSlides.has(number)) throw new Error(`revision plan.targetSlides includes missing before slide ${number}`);
  }

  requireObject(plan.allowedFields, "revision plan.allowedFields");
  requireObject(plan.invariants, "revision plan.invariants");
  const allowedFields = new Map();
  const invariants = new Map();

  for (const number of targetSlides) {
    const key = String(number);
    if (!Object.hasOwn(plan.allowedFields, key)) throw new Error(`revision plan.allowedFields is missing slide ${number}`);
    if (!Object.hasOwn(plan.invariants, key)) throw new Error(`revision plan.invariants is missing slide ${number}`);
    allowedFields.set(number, new Set(normalizeFieldList(plan.allowedFields[key], `revision plan.allowedFields.${key}`)));
    invariants.set(number, new Set(normalizeFieldList(plan.invariants[key], `revision plan.invariants.${key}`)));
  }

  const knownTargets = new Set(targetSlides.map(String));
  for (const section of ["allowedFields", "invariants"]) {
    for (const key of Object.keys(plan[section])) {
      if (!knownTargets.has(key)) throw new Error(`revision plan.${section} includes non-target slide ${key}`);
    }
  }
  return { targetSlides, allowedFields, invariants };
}

function changedFields(beforeSlide, afterSlide) {
  const fields = new Set([...Object.keys(beforeSlide), ...Object.keys(afterSlide)]);
  fields.delete("number");
  return [...fields].filter((field) => !sameValue(beforeSlide[field], afterSlide[field])).sort();
}

function violation(code, location, field) {
  return { code, ...location, ...(field ? { field } : {}) };
}

function compareDeckFields(beforeDeck, afterDeck) {
  const fields = new Set([...Object.keys(beforeDeck), ...Object.keys(afterDeck)]);
  fields.delete("slides");
  return [...fields].filter((field) => !sameValue(beforeDeck[field], afterDeck[field])).sort();
}

export function validateRevision(beforeDeck, afterDeck, revisionPlan) {
  const beforeSlides = validateDeck(beforeDeck, "before deck");
  const afterSlides = validateDeck(afterDeck, "after deck");
  const plan = normalizePlan(revisionPlan, beforeSlides);
  const targetSet = new Set(plan.targetSlides);
  const violations = [];
  const changes = [];

  for (const field of compareDeckFields(beforeDeck, afterDeck)) {
    changes.push({ scope: "deck", field });
    violations.push(violation("UNAUTHORIZED_FIELD_CHANGE", { scope: "deck" }, field));
  }

  const beforeOrder = beforeDeck.slides.map((slide) => slide.number);
  const afterOrder = afterDeck.slides.map((slide) => slide.number);
  if (!sameValue(beforeOrder, afterOrder)) {
    changes.push({ scope: "deck", field: "slides.order" });
    violations.push(violation("SLIDE_ORDER_CHANGED", { scope: "deck" }));
  }

  const allSlideNumbers = [...new Set([...beforeSlides.keys(), ...afterSlides.keys()])].sort((left, right) => left - right);
  for (const slideNumber of allSlideNumbers) {
    const beforeSlide = beforeSlides.get(slideNumber);
    const afterSlide = afterSlides.get(slideNumber);
    const location = { scope: "slide", slideNumber };

    if (!beforeSlide) {
      changes.push({ ...location, field: "slide" });
      violations.push(violation("SLIDE_ADDED", location));
      continue;
    }
    if (!afterSlide) {
      changes.push({ ...location, field: "slide" });
      violations.push(violation(targetSet.has(slideNumber) ? "TARGET_SLIDE_MISSING" : "OUT_OF_SCOPE_SLIDE_REMOVED", location));
      continue;
    }

    for (const field of changedFields(beforeSlide, afterSlide)) {
      changes.push({ ...location, field });
      const isTarget = targetSet.has(slideNumber);
      if (!isTarget) {
        if (DISPLAY_TEXT_FIELDS.has(field)) violations.push(violation("OUT_OF_SCOPE_DISPLAY_TEXT_CHANGED", location, field));
        if (field === "speakerNotes") violations.push(violation("OUT_OF_SCOPE_SPEAKER_NOTES_CHANGED", location, field));
        violations.push(violation("UNAUTHORIZED_FIELD_CHANGE", location, field));
        continue;
      }
      if (!plan.allowedFields.get(slideNumber).has(field)) violations.push(violation("UNAUTHORIZED_FIELD_CHANGE", location, field));
      if (plan.invariants.get(slideNumber).has(field)) violations.push(violation("TARGET_INVARIANT_VIOLATION", location, field));
    }
  }

  const orderedChanges = changes.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  const orderedViolations = violations.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  return {
    version: REPORT_VERSION,
    valid: orderedViolations.length === 0,
    status: orderedViolations.length === 0 ? "passed" : "failed",
    targetSlides: plan.targetSlides,
    summary: { changedFields: orderedChanges.length, violations: orderedViolations.length },
    changes: orderedChanges,
    violations: orderedViolations,
  };
}

function emit(report, pretty) {
  process.stdout.write(`${JSON.stringify(report, null, pretty ? 2 : 0)}\n`);
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const report = validateRevision(readJson(options.before, "before deck"), readJson(options.after, "after deck"), readJson(options.plan, "revision plan"));
    emit(report, options.pretty);
    process.exitCode = report.valid ? 0 : 1;
  } catch (error) {
    emit({
      version: REPORT_VERSION,
      valid: false,
      status: "invalid_input",
      error: error instanceof Error ? error.message : String(error),
    }, options?.pretty);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
