import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));

async function main() {
  const contract = await readJson("shared/kyozai-process-contract.json");
  const baseline = await readJson("shared/kyozai-skill-baseline.json");
  const expectedStages = ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design", "image_generate", "image_validate", "package", "revision"];
  const stageIds = contract.stages.map((stage) => stage.id);
  if (JSON.stringify(stageIds) !== JSON.stringify(expectedStages)) throw new Error("Process stage order does not match the approved contract");
  if (contract.textModelPolicy.forbidden.includes(contract.textModelPolicy.default)) throw new Error("Default text model is forbidden");
  if (contract.imageModelPolicy.oneRequestPerSlide !== true) throw new Error("One image request per slide is required");

  for (const [file, expectedHash] of Object.entries(baseline.files)) {
    const normalized = (await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n");
    const actualHash = createHash("sha256").update(normalized).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`${file}: approved Skill baseline changed`);
  }

  const sharedProfile = await readJson("shared/kyozai-design-profile.json");
  const skillProfile = await readJson(".agents/skills/kyozai-slide/references/kyozai-design-profile.json");
  const appProfile = await readJson("apps/web/lib/kyozai/design-profile.json");
  if (JSON.stringify(sharedProfile) !== JSON.stringify(skillProfile) || JSON.stringify(sharedProfile) !== JSON.stringify(appProfile)) {
    throw new Error("Skill, shared, and APP design profiles differ");
  }

  console.log(`Validated ${contract.id}@${contract.version}: ${stageIds.length} stages, ${Object.keys(baseline.files).length} Skill files`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
