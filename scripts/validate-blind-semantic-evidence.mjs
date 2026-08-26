import { readFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const AXES = ["source_fidelity", "learning_sequence", "speaker_script_usability", "visual_legibility", "delivery_completeness"];
const FIXTURES = ["direct_text", "long_pdf", "youtube_captioned", "reference_design", "natural_language_revision"];

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(midpoint)] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

async function main() {
  const evidencePath = process.argv[2];
  if (!evidencePath) throw new Error("usage: validate-blind-semantic-evidence.mjs <evidence.json>");
  const [schema, evidence] = await Promise.all([
    readFile(path.join(root, "shared/schemas/kyozai-blind-semantic-evidence.schema.json"), "utf8").then(JSON.parse),
    readFile(path.resolve(root, evidencePath), "utf8").then(JSON.parse),
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema);
  if (!validate(evidence)) throw new Error(`blind semantic evidence schema failed: ${JSON.stringify(validate.errors)}`);
  if (evidence.candidateMapping.candidateA === evidence.candidateMapping.candidateB) throw new Error("candidate mapping must reveal one Skill and one APP package");
  if (Date.parse(evidence.mappingDisclosedAt) < Date.parse(evidence.evaluatedAt)) throw new Error("candidate mapping cannot be disclosed before blind evaluation completes");
  const fixtureIds = evidence.fixtureResults.map((result) => result.fixtureId);
  if (new Set(fixtureIds).size !== FIXTURES.length || FIXTURES.some((fixture) => !fixtureIds.includes(fixture))) throw new Error("all five canonical fixtures must be evaluated exactly once");
  if (JSON.stringify([...evidence.rubric].sort()) !== JSON.stringify([...AXES].sort())) throw new Error("blind rubric must contain exactly the five canonical axes");
  const scores = { skill: Object.fromEntries(AXES.map((axis) => [axis, []])), app: Object.fromEntries(AXES.map((axis) => [axis, []])) };
  for (const fixture of evidence.fixtureResults) {
    const aliases = fixture.evaluators.map((entry) => entry.evaluatorAlias);
    if (new Set(aliases).size !== aliases.length) throw new Error(`${fixture.fixtureId}: evaluator aliases must be unique`);
    for (const entry of fixture.evaluators) {
      for (const [candidate, producer] of Object.entries(evidence.candidateMapping)) {
        const score = entry[candidate];
        if (score.severeSourceDeviationCount !== 0) throw new Error(`${fixture.fixtureId}: severe source deviation must be zero`);
        for (const axis of AXES) scores[producer][axis].push(score[axis]);
      }
    }
  }
  for (const axis of AXES) {
    if (median(scores.app[axis]) < median(scores.skill[axis]) - 0.5) throw new Error(`APP median is more than 0.5 below Skill for ${axis}`);
  }
  console.log(`Validated blind semantic evidence for ${FIXTURES.length} fixtures and ${AXES.length} axes`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
