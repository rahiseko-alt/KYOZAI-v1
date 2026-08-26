import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const digest = "a".repeat(64);

function evidence() {
  return {
    format: "kyozai-real-package-evidence@1.0.0",
    fixtureId: "direct_text",
    producer: "skill",
    packageDigest: digest,
    validatedAt: "2026-08-26T00:00:00.000Z",
    validator: "scripts/validate-blind-parity.mjs",
    commitSha: "b".repeat(40),
    ciRunUrl: "https://github.com/example/kyozai/actions/runs/123",
    attestationUrl: "https://github.com/example/kyozai/attestations/123",
    contentIncluded: false,
  };
}

async function withEvidence(mutator, assertion) {
  const directory = await mkdtemp(path.join(tmpdir(), "kyozai-provenance-evidence-"));
  try {
    const file = path.join(directory, "evidence.json");
    const value = evidence();
    mutator(value);
    await writeFile(file, JSON.stringify(value));
    const result = spawnSync(process.execPath, ["scripts/validate-real-package-evidence.mjs", file], { cwd: root, encoding: "utf8" });
    assertion(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("accepts non-content metadata only when it links an external attestation", async () => {
  await withEvidence(() => {}, (result) => assert.equal(result.status, 0, result.stderr));
});

test("rejects metadata that omits the external attestation", async () => {
  await withEvidence((value) => { delete value.attestationUrl; }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /attestationUrl/);
  });
});
