import { readFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();

async function main() {
  const contract = JSON.parse(await readFile(path.join(root, "shared/kyozai-parity-goal.json"), "utf8"));
  const goalSchema = JSON.parse(await readFile(path.join(root, "shared/schemas/kyozai-parity-goal.schema.json"), "utf8"));
  const goalValidator = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(goalSchema);
  if (!goalValidator(contract)) throw new Error(`Parity goal schema is invalid: ${JSON.stringify(goalValidator.errors)}`);
  const expectedGates = ["G0", "G1", "G2", "G3", "G4", "G5", "G6"];
  const expectedFixtures = ["direct_text", "long_pdf", "youtube_captioned", "reference_design", "natural_language_revision"];
  if (contract.id !== "kyozai-skill-app-parity" || !["in_progress", "completed"].includes(contract.status)) throw new Error("Parity goal status is invalid");
  if (JSON.stringify(contract.fixtures) !== JSON.stringify(expectedFixtures)) throw new Error("The five required parity fixtures changed");
  if (JSON.stringify(contract.gates?.map((gate) => gate.id)) !== JSON.stringify(expectedGates)) throw new Error("Gate order must remain G0 through G6");
  const expectedInProgressGeneration = contract.deliveryMode === "personal_pwa" ? "personal_pwa_enabled" : "locked_404";
  if (contract.status === "in_progress" && (!expectedGates.includes(contract.activeGate) || contract.productionGeneration !== expectedInProgressGeneration)) {
    throw new Error("An incomplete parity goal requires one active Gate and the configured Production generation state");
  }
  if (contract.status === "completed" && (contract.activeGate !== null || contract.productionGeneration !== "authenticated_enabled")) {
    throw new Error("A completed parity goal requires no active Gate and authenticated Production generation");
  }
  let activeCount = 0;
  let pendingSeen = false;
  for (const gate of contract.gates) {
    if (!Array.isArray(gate.acceptanceEvidence) || gate.acceptanceEvidence.length === 0
      || !Array.isArray(gate.gaps) || !String(gate.goalContribution ?? "").trim()) {
      throw new Error(`${gate.id}: contribution, gaps and acceptance evidence are required`);
    }
    if (!['pending', 'in_progress', 'completed'].includes(gate.status)) throw new Error(`${gate.id}: invalid status`);
    if (gate.status === "completed" && gate.gaps.length !== 0) throw new Error(`${gate.id}: completed Gate cannot retain unresolved gaps`);
    if (gate.status !== "completed" && gate.gaps.length === 0) throw new Error(`${gate.id}: incomplete Gate requires at least one gap`);
    if (gate.status === "in_progress") activeCount += 1;
    if (gate.status === "pending") pendingSeen = true;
    if (pendingSeen && gate.status !== "pending") throw new Error(`${gate.id}: a later Gate cannot start before the preceding Gate completes`);
    if (gate.status === "completed" && (!Array.isArray(gate.evidence) || gate.evidence.length === 0)) {
      throw new Error(`${gate.id}: completed Gate requires external evidence`);
    }
  }
  const active = contract.gates.find((gate) => gate.id === contract.activeGate);
  if (contract.status === "in_progress" && (activeCount !== 1 || active?.status !== "in_progress")) throw new Error("Exactly one active Gate must be in progress");
  if (contract.status === "completed" && (activeCount !== 0 || contract.gates.some((gate) => gate.status !== "completed"))) {
    throw new Error("Every Gate must be completed before the goal can complete");
  }
  const schemaFiles = ["kyozai-deck-spec.schema.json", "kyozai-stage-ledger.schema.json", "kyozai-package-manifest.schema.json", "kyozai-blind-semantic-evidence.schema.json", "kyozai-real-package-evidence.schema.json"];
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  for (const filename of schemaFiles) {
    ajv.compile(JSON.parse(await readFile(path.join(root, "shared", "schemas", filename), "utf8")));
  }
  console.log(`Validated ${contract.id}@${contract.version}: ${contract.status}, active ${contract.activeGate ?? "none"}, ${contract.fixtures.length} fixtures, ${schemaFiles.length} schemas`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
