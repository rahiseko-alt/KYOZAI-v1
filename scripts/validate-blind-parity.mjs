import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const EXPECTED_STAGES = ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design", "image_generate", "image_validate", "package"];
const REQUIRED_PATHS = ["deck-spec.json", "deck-content-and-script.txt", "source-info.json", "image-prompts.json", "image-validation.json", "stage-ledger.json", "montage.png"];
const SHA256 = /^[0-9a-f]{64}$/;
const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(candidate, message) {
  throw new Error(`${candidate}: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedPath(value) {
  return value.split(path.sep).join("/");
}

async function filesBelow(directory, current = directory) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(directory, absolute));
    else if (entry.isFile()) files.push(normalizedPath(path.relative(directory, absolute)));
    else throw new Error(`unsupported package entry: ${entry.name}`);
  }
  return files.sort();
}

async function bytesAt(directory, filename) {
  return readFile(path.join(directory, ...filename.split("/")));
}

async function jsonAt(candidate, directory, filename) {
  try {
    return JSON.parse((await bytesAt(directory, filename)).toString("utf8"));
  } catch {
    fail(candidate, `${filename} is not valid JSON`);
  }
}

function assertDeck(candidate, deck) {
  const contract = deck.processContract ?? deck.process?.contract;
  if (contract !== "kyozai-slide-process@1.0.0") fail(candidate, "deck process contract is not canonical");
  if (deck.designProfile !== "kyozai-standard@1.0.0") fail(candidate, "design profile is not canonical");
  if (!Array.isArray(deck.slides) || deck.slides.length < 4 || deck.slides.length > 12) fail(candidate, "slide count must be 4–12");
  if (deck.slides[0]?.layoutFamily !== "cover" || deck.slides.at(-1)?.layoutFamily !== "action") fail(candidate, "cover/action contract failed");
  let totalCharacters = 0;
  let totalSeconds = 0;
  for (const [index, slide] of deck.slides.entries()) {
    if (slide.number !== index + 1) fail(candidate, "slide numbers must be sequential");
    const characters = [...String(slide.speakerNotes ?? "")].length;
    const duration = Math.round((characters / 300) * 60);
    if (slide.scriptCharacters !== characters || slide.durationSeconds !== duration) fail(candidate, `slide ${slide.number} timing is not 300 characters/minute`);
    totalCharacters += characters;
    totalSeconds += duration;
    if (index >= 2 && slide.layoutFamily === deck.slides[index - 1]?.layoutFamily && slide.layoutFamily === deck.slides[index - 2]?.layoutFamily) {
      fail(candidate, "the same layout family appears three times in a row");
    }
  }
  const declaredCharacters = deck.totalScriptCharacters ?? deck.process?.totalScriptCharacters;
  const declaredSeconds = deck.totalDurationSeconds ?? deck.process?.totalDurationSeconds;
  if (declaredCharacters !== totalCharacters || declaredSeconds !== totalSeconds) fail(candidate, "deck totals do not match slide narration");
  return { slideCount: deck.slides.length, contract };
}

function assertLedger(candidate, value) {
  const entries = Array.isArray(value) ? value : value?.entries;
  if (!Array.isArray(entries) || entries.length !== EXPECTED_STAGES.length) fail(candidate, "stage ledger must contain exactly the nine canonical stages");
  let previousCompleted = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of entries.entries()) {
    if (entry.stage !== EXPECTED_STAGES[index]) fail(candidate, "stage ledger order is not canonical");
    if (entry.status !== "passed") fail(candidate, `${entry.stage} did not pass`);
    const started = Date.parse(entry.startedAt);
    const completed = Date.parse(entry.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) fail(candidate, `${entry.stage} timestamps are invalid`);
    if (started < previousCompleted) fail(candidate, `${entry.stage} started before the previous stage completed`);
    previousCompleted = completed;
  }
  const freezeCompleted = Date.parse(entries[4].completedAt);
  const firstImageStarted = Date.parse(entries[6].startedAt);
  if (firstImageStarted < freezeCompleted) fail(candidate, "image generation started before content freeze passed");
  return entries;
}

function assertPrompts(candidate, prompts, slideCount) {
  if (!Array.isArray(prompts) || prompts.length !== slideCount) fail(candidate, "image prompts must cover every slide");
  prompts.forEach((prompt, index) => {
    if (prompt.slideNumber !== index + 1 || typeof prompt.prompt !== "string" || prompt.prompt.length < 20) fail(candidate, "image prompt is missing or mapped to the wrong slide");
    if (prompt.promptHash !== sha256(Buffer.from(prompt.prompt))) fail(candidate, `slide ${index + 1} prompt hash mismatch`);
  });
}

function assertValidations(candidate, validations, slideCount) {
  if (!Array.isArray(validations) || validations.length !== slideCount) fail(candidate, "image validation must cover every slide");
  validations.forEach((validation, index) => {
    if (validation.slideNumber !== index + 1 || validation.status !== "passed" || !SHA256.test(validation.imageHash ?? "")) {
      fail(candidate, `slide ${index + 1} image validation is incomplete`);
    }
    if (!Number.isInteger(validation.attemptCount) || validation.attemptCount < 1 || validation.attemptCount > 2) fail(candidate, `slide ${index + 1} attempt count is invalid`);
    if (!Array.isArray(validation.structuralChecks) || validation.structuralChecks.length === 0
      || !Array.isArray(validation.visualChecks) || validation.visualChecks.length === 0) {
      fail(candidate, `slide ${index + 1} image checks are empty`);
    }
  });
}

async function assertManifest(candidate, directory, manifest, expectedProducer, slideCount, allowContractFixture) {
  if (manifest.format !== "kyozai-package@2.0.0" || manifest.producer !== expectedProducer) fail(candidate, "package producer or format is wrong");
  if (manifest.evidenceMode !== "real" && !(allowContractFixture && manifest.evidenceMode === "contract_test")) fail(candidate, "mock or contract-test output is not real parity evidence");
  if (!String(manifest.fixtureId ?? "").trim() || !SHA256.test(manifest.sourceHash ?? "")) fail(candidate, "fixture or source hash is missing");
  if (manifest.processContract !== "kyozai-slide-process@1.0.0" || manifest.designProfile !== "kyozai-standard@1.0.0") fail(candidate, "manifest contracts are not canonical");
  if (manifest.contentFreezePassed !== true || manifest.generatedSlideCount !== slideCount) fail(candidate, "manifest completion claims are invalid");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail(candidate, "manifest files are empty");

  const diskFiles = (await filesBelow(directory)).filter((filename) => filename !== "manifest.json");
  const declaredPaths = manifest.files.map((entry) => entry.path);
  if (new Set(declaredPaths).size !== declaredPaths.length) fail(candidate, "manifest contains duplicate paths");
  if (JSON.stringify([...declaredPaths].sort()) !== JSON.stringify(diskFiles)) fail(candidate, "manifest paths do not match the package");
  for (const required of REQUIRED_PATHS) if (!declaredPaths.includes(required)) fail(candidate, `${required} is missing from the manifest`);
  if (!declaredPaths.some((filename) => filename.startsWith("source/"))) fail(candidate, "source/ is missing from the package");

  const images = manifest.files.filter((entry) => entry.kind === "slide_image").sort((a, b) => a.slideNumber - b.slideNumber);
  if (images.length !== slideCount) fail(candidate, "manifest slide image count is wrong");
  for (const [index, entry] of manifest.files.entries()) {
    if (typeof entry.path !== "string" || !entry.path || !SHA256.test(entry.sha256 ?? "") || !Number.isInteger(entry.byteSize) || entry.byteSize < 1) {
      fail(candidate, `manifest file entry ${index + 1} is invalid`);
    }
    const bytes = await bytesAt(directory, entry.path);
    if (bytes.length !== entry.byteSize || sha256(bytes) !== entry.sha256) fail(candidate, `${entry.path} bytes or hash differ from the manifest`);
  }
  for (const [index, image] of images.entries()) {
    if (image.slideNumber !== index + 1 || image.path !== `images/slide-${String(index + 1).padStart(2, "0")}.png`) fail(candidate, "slide image path or number is invalid");
    const bytes = await bytesAt(directory, image.path);
    if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) fail(candidate, `${image.path} is not a PNG`);
  }
  const montage = await bytesAt(directory, "montage.png");
  if (!montage.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) fail(candidate, "montage.png is not a PNG");
  return { images, packageDigest: sha256(Buffer.from(manifest.files.map((entry) => `${entry.path}:${entry.sha256}:${entry.byteSize}`).sort().join("\n"))) };
}

async function inspect(candidate, directory, expectedProducer, allowContractFixture) {
  const manifest = await jsonAt(candidate, directory, "manifest.json");
  const deck = await jsonAt(candidate, directory, "deck-spec.json");
  const { slideCount, contract } = assertDeck(candidate, deck);
  const ledger = assertLedger(candidate, await jsonAt(candidate, directory, "stage-ledger.json"));
  const prompts = await jsonAt(candidate, directory, "image-prompts.json");
  const validations = await jsonAt(candidate, directory, "image-validation.json");
  assertPrompts(candidate, prompts, slideCount);
  assertValidations(candidate, validations, slideCount);
  const sourceInfo = await jsonAt(candidate, directory, "source-info.json");
  if (sourceInfo.sourceHash !== manifest.sourceHash || !Array.isArray(sourceInfo.refs) || sourceInfo.refs.length === 0) fail(candidate, "source info is not traceable to the manifest");
  const { images, packageDigest } = await assertManifest(candidate, directory, manifest, expectedProducer, slideCount, allowContractFixture);
  for (const [index, image] of images.entries()) {
    if (validations[index].imageHash !== image.sha256) fail(candidate, `slide ${index + 1} validation hash does not match the final PNG`);
  }
  return {
    candidate,
    producer: expectedProducer,
    fixtureId: manifest.fixtureId,
    sourceHash: manifest.sourceHash,
    processContract: contract,
    designProfile: deck.designProfile,
    evidenceMode: manifest.evidenceMode,
    slideCount,
    packageDigest,
    stageWindow: { startedAt: ledger[0].startedAt, completedAt: ledger.at(-1).completedAt },
  };
}

async function main() {
  const skill = option("--skill");
  const app = option("--app");
  const out = option("--out");
  const allowContractFixture = process.argv.includes("--allow-contract-fixture");
  if (!skill || !out) throw new Error("usage: --skill <extracted-package> [--app <extracted-package>] --out <evidence.json>");
  if (!app) {
    const candidate = await inspect("candidate-a", path.resolve(root, skill), "skill", allowContractFixture);
    const evidence = {
      format: "kyozai-package-validation-evidence@1.0.0",
      rubric: ["stage_order", "freeze_before_images", "300_characters_per_minute", "design_profile", "image_validation", "manifest_integrity", "source_traceability"],
      fixtureId: candidate.fixtureId,
      candidate: (({ producer: _producer, fixtureId: _fixtureId, sourceHash: _sourceHash, ...value }) => value)(candidate),
    };
    await writeFile(path.resolve(root, out), `${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }
  const candidates = await Promise.all([
    inspect("candidate-a", path.resolve(root, skill), "skill", allowContractFixture),
    inspect("candidate-b", path.resolve(root, app), "app", allowContractFixture),
  ]);
  if (candidates[0].fixtureId !== candidates[1].fixtureId || candidates[0].sourceHash !== candidates[1].sourceHash) throw new Error("candidates do not represent the same normalized fixture");
  if (candidates[0].processContract !== candidates[1].processContract || candidates[0].designProfile !== candidates[1].designProfile) throw new Error("candidates do not share the canonical contracts");
  const evidence = {
    format: "kyozai-blind-parity-evidence@2.0.0",
    rubric: ["stage_order", "freeze_before_images", "300_characters_per_minute", "design_profile", "image_validation", "manifest_integrity", "source_traceability"],
    fixtureId: candidates[0].fixtureId,
    candidates: candidates.map(({ producer: _producer, fixtureId: _fixtureId, sourceHash: _sourceHash, ...candidate }) => candidate),
  };
  await writeFile(path.resolve(root, out), `${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
