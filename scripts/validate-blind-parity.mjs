import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = ["deck-spec.json", "image-prompts.json", "image-validation.json", "manifest.json", "stage-ledger.json"];
const expectedStages = ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design", "image_generate", "image_validate", "package"];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJson(directory, filename) {
  const bytes = await readFile(path.resolve(root, directory, filename));
  return { value: JSON.parse(bytes.toString("utf8")), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function assertDeck(candidate, deck) {
  if (deck.designProfile !== "kyozai-standard@1.0.0") throw new Error(`${candidate}: design profile is not canonical`);
  if (!Array.isArray(deck.slides) || deck.slides.length < 4 || deck.slides.length > 12) throw new Error(`${candidate}: slide count must be 4–12`);
  if (deck.slides[0]?.layoutFamily !== "cover" || deck.slides.at(-1)?.layoutFamily !== "action") throw new Error(`${candidate}: cover/action contract failed`);
  for (const slide of deck.slides) {
    const characters = [...String(slide.speakerNotes ?? "")].length;
    if (slide.scriptCharacters !== characters || slide.durationSeconds !== Math.round((characters / 300) * 60)) {
      throw new Error(`${candidate}: slide ${slide.number} timing is not 300 characters/minute`);
    }
  }
}

function assertLedger(candidate, ledger) {
  const passed = new Set((Array.isArray(ledger) ? ledger : ledger.stages ?? []).filter((stage) => stage.status === "passed").map((stage) => stage.stage));
  if (expectedStages.some((stage) => !passed.has(stage))) throw new Error(`${candidate}: incomplete stage ledger`);
}

async function inspect(candidate, directory) {
  const entries = await Promise.all(requiredFiles.map(async (filename) => [filename, await readJson(directory, filename)]));
  const files = Object.fromEntries(entries);
  assertDeck(candidate, files["deck-spec.json"].value);
  assertLedger(candidate, files["stage-ledger.json"].value);
  return { candidate, fileHashes: Object.fromEntries(Object.entries(files).map(([filename, data]) => [filename, data.sha256])) };
}

async function main() {
  const skill = option("--skill");
  const app = option("--app");
  const out = option("--out");
  if (!skill || !app || !out) throw new Error("usage: --skill <final-package> --app <final-package> --out <blind-evidence.json>");
  const evidence = {
    rubric: ["stage_order", "freeze_before_images", "300_characters_per_minute", "design_profile", "image_validation", "manifest", "package"],
    candidates: await Promise.all([inspect("candidate-a", skill), inspect("candidate-b", app)]),
  };
  await writeFile(path.resolve(root, out), `${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
