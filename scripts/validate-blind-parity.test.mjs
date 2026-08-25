import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const ledger = ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design", "image_generate", "image_validate", "package"].map((stage) => ({ stage, status: "passed" }));
const deck = {
  designProfile: "kyozai-standard@1.0.0",
  slides: ["cover", "focus", "compare", "action"].map((layoutFamily, index) => {
    const speakerNotes = "確認する".repeat(index + 1);
    return { number: index + 1, layoutFamily, speakerNotes, scriptCharacters: [...speakerNotes].length, durationSeconds: Math.round(([...speakerNotes].length / 300) * 60) };
  }),
};

async function packageAt(directory) {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "deck-spec.json"), JSON.stringify(deck)),
    writeFile(path.join(directory, "stage-ledger.json"), JSON.stringify(ledger)),
    writeFile(path.join(directory, "image-prompts.json"), "[]"),
    writeFile(path.join(directory, "image-validation.json"), "{}"),
    writeFile(path.join(directory, "manifest.json"), "{}"),
  ]);
}

test("blind parity validator produces anonymous, contract-only evidence", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "kyozai-parity-"));
  try {
    const skill = path.join(temp, "skill");
    const app = path.join(temp, "app");
    const output = path.join(temp, "blind.json");
    await Promise.all([packageAt(skill), packageAt(app)]);
    const run = spawnSync(process.execPath, ["scripts/validate-blind-parity.mjs", "--skill", skill, "--app", app, "--out", output], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const evidence = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(evidence.candidates.map((candidate) => candidate.candidate), ["candidate-a", "candidate-b"]);
    assert.equal(evidence.candidates[0].fileHashes["deck-spec.json"], evidence.candidates[1].fileHashes["deck-spec.json"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
