import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const STAGES = ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design", "image_generate", "image_validate", "package"];
const hash = (value) => createHash("sha256").update(value).digest("hex");

function deck() {
  const slides = ["cover", "focus", "compare", "action"].map((layoutFamily, index) => {
    const speakerNotes = "内容を確認する。".repeat(index + 2);
    return {
      number: index + 1,
      layoutFamily,
      speakerNotes,
      scriptCharacters: [...speakerNotes].length,
      durationSeconds: Math.round(([...speakerNotes].length / 300) * 60),
    };
  });
  return {
    processContract: "kyozai-slide-process@1.0.0",
    designProfile: "kyozai-standard@1.0.0",
    slides,
    totalScriptCharacters: slides.reduce((sum, slide) => sum + slide.scriptCharacters, 0),
    totalDurationSeconds: slides.reduce((sum, slide) => sum + slide.durationSeconds, 0),
  };
}

function ledger() {
  const base = Date.parse("2026-08-26T00:00:00.000Z");
  return STAGES.map((stage, index) => ({
    stage,
    status: "passed",
    startedAt: new Date(base + index * 120_000).toISOString(),
    completedAt: new Date(base + index * 120_000 + 60_000).toISOString(),
  }));
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2));
}

function kindFor(filename) {
  if (filename.startsWith("images/")) return "slide_image";
  if (filename.startsWith("source/")) return "source";
  return {
    "deck-spec.json": "deck_spec",
    "deck-content-and-script.txt": "deck_content_and_script",
    "source-info.json": "source_info",
    "image-prompts.json": "image_prompts",
    "image-validation.json": "image_validation",
    "stage-ledger.json": "stage_ledger",
    "montage.png": "montage",
  }[filename];
}

function mediaTypeFor(filename) {
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".png")) return "image/png";
  return "text/plain";
}

async function packageAt(directory, producer, fixtureId = "direct-input-foundations") {
  await mkdir(path.join(directory, "images"), { recursive: true });
  await mkdir(path.join(directory, "source"), { recursive: true });
  const source = Buffer.from("独自に作成した情報管理研修の入力本文です。");
  const sourceHash = hash(source);
  const prompts = [1, 2, 3, 4].map((slideNumber) => {
    const prompt = `Contract fixture prompt for slide ${slideNumber}: render only the frozen Japanese teaching content.`;
    return { slideNumber, prompt, promptHash: hash(Buffer.from(prompt)) };
  });
  const validations = [1, 2, 3, 4].map((slideNumber) => ({
    slideNumber,
    imageHash: hash(PNG),
    attemptCount: 1,
    status: "passed",
    structuralChecks: ["png-decode", "1672x941", "nonblank"],
    visualChecks: ["text-match", "contrast", "layout"],
  }));
  await Promise.all([
    writeJson(path.join(directory, "deck-spec.json"), deck()),
    writeFile(path.join(directory, "deck-content-and-script.txt"), "表示内容と講師台本"),
    writeJson(path.join(directory, "source-info.json"), { sourceHash, refs: ["source/original.txt"] }),
    writeJson(path.join(directory, "image-prompts.json"), prompts),
    writeJson(path.join(directory, "image-validation.json"), validations),
    writeJson(path.join(directory, "stage-ledger.json"), ledger()),
    writeFile(path.join(directory, "montage.png"), PNG),
    writeFile(path.join(directory, "source", "original.txt"), source),
    ...[1, 2, 3, 4].map((number) => writeFile(path.join(directory, "images", `slide-${String(number).padStart(2, "0")}.png`), PNG)),
  ]);
  const relativeFiles = [
    "deck-spec.json",
    "deck-content-and-script.txt",
    "source-info.json",
    "image-prompts.json",
    "image-validation.json",
    "stage-ledger.json",
    "montage.png",
    "source/original.txt",
    ...[1, 2, 3, 4].map((number) => `images/slide-${String(number).padStart(2, "0")}.png`),
  ].sort();
  const files = await Promise.all(relativeFiles.map(async (filename) => {
    const bytes = await readFile(path.join(directory, ...filename.split("/")));
    const slideNumber = filename.startsWith("images/") ? Number(filename.match(/(\d+)\.png$/)?.[1]) : undefined;
    return {
      path: filename,
      kind: kindFor(filename),
      mediaType: mediaTypeFor(filename),
      byteSize: bytes.length,
      sha256: hash(bytes),
      ...(slideNumber ? { slideNumber } : {}),
    };
  }));
  await writeJson(path.join(directory, "manifest.json"), {
    format: "kyozai-package@2.0.0",
    producer,
    evidenceMode: "contract_test",
    fixtureId,
    processContract: "kyozai-slide-process@1.0.0",
    designProfile: "kyozai-standard@1.0.0",
    sourceHash,
    contentFreezePassed: true,
    generatedSlideCount: 4,
    files,
  });
}

function runValidator(skill, app, output, allowContractFixture = true) {
  const args = ["scripts/validate-blind-parity.mjs", "--skill", skill, "--app", app, "--out", output];
  if (allowContractFixture) args.push("--allow-contract-fixture");
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
}

function runSkillValidator(skill, output, allowContractFixture = true) {
  const args = ["scripts/validate-blind-parity.mjs", "--skill", skill, "--out", output];
  if (allowContractFixture) args.push("--allow-contract-fixture");
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
}

async function withPackages(callback) {
  const temp = await mkdtemp(path.join(tmpdir(), "kyozai-parity-"));
  try {
    const skill = path.join(temp, "skill");
    const app = path.join(temp, "app");
    const output = path.join(temp, "blind.json");
    await Promise.all([packageAt(skill, "skill"), packageAt(app, "app")]);
    await callback({ temp, skill, app, output });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test("valid contract packages produce anonymous evidence", async () => {
  await withPackages(async ({ skill, app, output, temp }) => {
    const run = runValidator(skill, app, output);
    assert.equal(run.status, 0, run.stderr);
    const evidence = await json(output);
    assert.equal(evidence.format, "kyozai-blind-parity-evidence@2.0.0");
    assert.deepEqual(evidence.candidates.map((candidate) => candidate.candidate), ["candidate-a", "candidate-b"]);
    assert.equal(JSON.stringify(evidence).includes(temp), false);
    assert.equal("producer" in evidence.candidates[0], false);
  });
});

test("valid Skill contract package produces anonymous single-package evidence", async () => {
  await withPackages(async ({ skill, output, temp }) => {
    const run = runSkillValidator(skill, output);
    assert.equal(run.status, 0, run.stderr);
    const evidence = await json(output);
    assert.equal(evidence.format, "kyozai-package-validation-evidence@1.0.0");
    assert.equal(evidence.fixtureId, "direct-input-foundations");
    assert.equal(JSON.stringify(evidence).includes(temp), false);
    assert.equal("producer" in evidence.candidate, false);
  });
});

test("contract-test packages cannot be used as real parity evidence", async () => {
  await withPackages(async ({ skill, app, output }) => {
    const run = runValidator(skill, app, output, false);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /not real parity evidence/);
  });
});

test("contract-test Skill package cannot be used as real G0 evidence", async () => {
  await withPackages(async ({ skill, output }) => {
    const run = runSkillValidator(skill, output, false);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /not real parity evidence/);
  });
});

const corruptions = [
  {
    name: "reversed stage order",
    mutate: async ({ app }) => {
      const file = path.join(app, "stage-ledger.json");
      await writeJson(file, (await json(file)).reverse());
    },
  },
  {
    name: "image generation before content freeze",
    mutate: async ({ app }) => {
      const file = path.join(app, "stage-ledger.json");
      const value = await json(file);
      value[6].startedAt = "2026-08-26T00:00:00.000Z";
      await writeJson(file, value);
    },
  },
  {
    name: "empty image validation",
    mutate: async ({ app }) => writeJson(path.join(app, "image-validation.json"), []),
  },
  {
    name: "empty manifest",
    mutate: async ({ app }) => writeJson(path.join(app, "manifest.json"), {}),
  },
  {
    name: "missing final image",
    mutate: async ({ app }) => rm(path.join(app, "images", "slide-04.png")),
  },
  {
    name: "changed image bytes",
    mutate: async ({ app }) => writeFile(path.join(app, "images", "slide-04.png"), Buffer.concat([PNG, Buffer.from("changed")])),
  },
  {
    name: "artifact omitted from manifest",
    mutate: async ({ app }) => writeFile(path.join(app, "untracked-artifact.txt"), "manifestに未記載の成果物"),
  },
  {
    name: "Skill and APP producer swap",
    mutate: async ({ app }) => {
      const file = path.join(app, "manifest.json");
      const value = await json(file);
      value.producer = "skill";
      await writeJson(file, value);
    },
  },
];

for (const corruption of corruptions) {
  test(`rejects ${corruption.name}`, async () => {
    await withPackages(async (context) => {
      await corruption.mutate(context);
      const run = runValidator(context.skill, context.app, context.output);
      assert.notEqual(run.status, 0, `${corruption.name} unexpectedly passed`);
    });
  });
}

test("rejects candidates created from different fixtures", async () => {
  await withPackages(async ({ skill, app, output }) => {
    const file = path.join(app, "manifest.json");
    const value = await json(file);
    value.fixtureId = "different-fixture";
    await writeJson(file, value);
    const run = runValidator(skill, app, output);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /same normalized fixture/);
  });
});
