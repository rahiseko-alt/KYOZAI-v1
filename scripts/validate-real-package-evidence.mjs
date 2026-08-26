import { readFile } from "node:fs/promises";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();

async function main() {
  const evidencePath = process.argv[2];
  if (!evidencePath) throw new Error("usage: validate-real-package-evidence.mjs <evidence.json>");
  const [schema, evidence] = await Promise.all([
    readFile(path.join(root, "shared/schemas/kyozai-real-package-evidence.schema.json"), "utf8").then(JSON.parse),
    readFile(path.resolve(root, evidencePath), "utf8").then(JSON.parse),
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema);
  if (!validate(evidence)) throw new Error(`real package evidence schema failed: ${JSON.stringify(validate.errors)}`);
  console.log(`Validated attested metadata for ${evidence.producer}:${evidence.fixtureId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
