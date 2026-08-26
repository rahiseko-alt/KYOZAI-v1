import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const fixtures = ["direct_text", "long_pdf", "youtube_captioned", "reference_design", "natural_language_revision"];
const axes = ["source_fidelity", "learning_sequence", "speaker_script_usability", "visual_legibility", "delivery_completeness"];

function score(value = 4) {
  return Object.fromEntries([...axes.map((axis) => [axis, value]), ["severeSourceDeviationCount", 0]]);
}

function evidence() {
  return {
    format: "kyozai-blind-semantic-evidence@1.0.0",
    evaluatedAt: "2026-08-26T00:00:00.000Z",
    mappingDisclosedAt: "2026-08-26T00:01:00.000Z",
    rubric: axes,
    candidateMapping: { candidateA: "skill", candidateB: "app" },
    fixtureResults: fixtures.map((fixtureId) => ({
      fixtureId,
      evaluators: ["reviewer-a", "reviewer-b", "reviewer-c"].map((evaluatorAlias) => ({ evaluatorAlias, candidateA: score(), candidateB: score() })),
    })),
  };
}

async function withEvidence(mutator, assertion) {
  const directory = await mkdtemp(path.join(tmpdir(), "kyozai-semantic-evidence-"));
  try {
    const file = path.join(directory, "evidence.json");
    const value = evidence();
    mutator(value);
    await writeFile(file, JSON.stringify(value));
    const result = spawnSync(process.execPath, ["scripts/validate-blind-semantic-evidence.mjs", file], { cwd: root, encoding: "utf8" });
    assertion(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("accepts a complete blinded five-fixture semantic evaluation", async () => {
  await withEvidence(() => {}, (result) => assert.equal(result.status, 0, result.stderr));
});

test("rejects an APP median more than 0.5 below Skill", async () => {
  await withEvidence((value) => {
    for (const fixture of value.fixtureResults) for (const evaluator of fixture.evaluators) evaluator.candidateB.visual_legibility = 3;
  }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /visual_legibility/);
  });
});

test("rejects a severe source deviation even when scores are high", async () => {
  await withEvidence((value) => { value.fixtureResults[0].evaluators[0].candidateB.severeSourceDeviationCount = 1; }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /severe source deviation/);
  });
});
