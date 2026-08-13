import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = new URL("./validate_revision.mjs", import.meta.url);
const scriptPath = fileURLToPath(script);

function deck() {
  return {
    processContract: "kyozai-slide-process@1.0.0",
    designProfile: "kyozai-standard@1.0.0",
    title: "Revision validation",
    slides: [
      { number: 1, title: "Start", theme: "Introduction", role: "introduction", layoutFamily: "cover", labels: [], keyMessage: "Welcome", bullets: ["One"], speakerNotes: "Opening notes", scriptCharacters: 13, durationSeconds: 3 },
      { number: 2, title: "Core idea", theme: "Main topic", role: "understanding", layoutFamily: "focus", labels: [], keyMessage: "Explain the core idea", bullets: ["First", "Second"], speakerNotes: "Explain the core idea with a simple example.", scriptCharacters: 42, durationSeconds: 9 },
      { number: 3, title: "Next step", theme: "Action", role: "action", layoutFamily: "action", labels: [], keyMessage: "Try it", bullets: ["Act"], speakerNotes: "Close with the next step.", scriptCharacters: 25, durationSeconds: 5 },
    ],
  };
}

function plan(overrides = {}) {
  return {
    targetSlides: [2],
    allowedFields: { "2": ["title", "speakerNotes"] },
    invariants: { "2": ["layoutFamily", "role"] },
    ...overrides,
  };
}

function run(before, after, revisionPlan) {
  const directory = mkdtempSync(join(tmpdir(), "kyozai-revise-test-"));
  try {
    const beforePath = join(directory, "before.json");
    const afterPath = join(directory, "after.json");
    const planPath = join(directory, "plan.json");
    writeFileSync(beforePath, JSON.stringify(before));
    writeFileSync(afterPath, JSON.stringify(after));
    writeFileSync(planPath, JSON.stringify(revisionPlan));
    const result = spawnSync(process.execPath, [scriptPath, "--before", beforePath, "--after", afterPath, "--plan", planPath], { encoding: "utf8" });
    return { status: result.status, report: JSON.parse(result.stdout), stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("passes a target-only change to a permitted field", () => {
  const before = deck();
  const after = structuredClone(before);
  after.slides[1].title = "Shorter core idea";
  const result = run(before, after, plan());
  assert.equal(result.status, 0);
  assert.equal(result.report.valid, true);
  assert.deepEqual(result.report.changes, [{ scope: "slide", slideNumber: 2, field: "title" }]);
  assert.deepEqual(result.report.violations, []);
});

test("rejects display text changes outside the target slide", () => {
  const before = deck();
  const after = structuredClone(before);
  after.slides[0].keyMessage = "Changed outside the scope";
  const result = run(before, after, plan());
  assert.equal(result.status, 1);
  assert.deepEqual(result.report.violations.map((item) => item.code), ["OUT_OF_SCOPE_DISPLAY_TEXT_CHANGED", "UNAUTHORIZED_FIELD_CHANGE"]);
});

test("rejects speaker note changes outside the target slide", () => {
  const before = deck();
  const after = structuredClone(before);
  after.slides[2].speakerNotes = "Changed notes outside the scope.";
  const result = run(before, after, plan());
  assert.equal(result.status, 1);
  assert.deepEqual(result.report.violations.map((item) => item.code), ["OUT_OF_SCOPE_SPEAKER_NOTES_CHANGED", "UNAUTHORIZED_FIELD_CHANGE"]);
});

test("rejects both a target field outside the plan and a target invariant change", () => {
  const before = deck();
  const after = structuredClone(before);
  after.slides[1].bullets = ["Changed"];
  after.slides[1].layoutFamily = "checklist";
  const result = run(before, after, plan());
  assert.equal(result.status, 1);
  assert.deepEqual(result.report.violations.map((item) => item.code), ["TARGET_INVARIANT_VIOLATION", "UNAUTHORIZED_FIELD_CHANGE", "UNAUTHORIZED_FIELD_CHANGE"]);
  assert.equal(result.report.violations.find((item) => item.code === "TARGET_INVARIANT_VIOLATION")?.field, "layoutFamily");
});

test("returns invalid_input for a malformed plan and produces deterministic JSON", () => {
  const before = deck();
  const malformed = plan({ allowedFields: { "2": ["unknown"] } });
  const first = run(before, before, malformed);
  const second = run(before, before, malformed);
  assert.equal(first.status, 2);
  assert.equal(first.report.status, "invalid_input");
  assert.deepEqual(first.report, second.report);
});
