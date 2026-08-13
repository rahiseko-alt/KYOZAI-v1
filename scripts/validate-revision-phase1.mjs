import { readFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("shared/fixtures/revision-phase1/benchmark.json");
const fixture = JSON.parse(await readFile(source, "utf8"));
const expected = new Map([["success", 20], ["reject", 20], ["version-flow", 10]]);
const groups = fixture.groups;

if (!Array.isArray(groups) || groups.length !== expected.size) throw new Error(`${source}: exactly three fixture groups are required`);
const ids = new Set();
for (const group of groups) {
  if (!expected.has(group.id) || !Array.isArray(group.cases) || group.cases.length !== expected.get(group.id)) {
    throw new Error(`${source}: ${group.id} has an invalid case count`);
  }
  for (const entry of group.cases) {
    if (typeof entry.id !== "string" || ids.has(entry.id)) throw new Error(`${source}: case ids must be unique`);
    ids.add(entry.id);
  }
}
if (ids.size !== 50) throw new Error(`${source}: expected 50 cases, found ${ids.size}`);
console.log(`Validated ${ids.size} Phase 1 revision cases (success 20, reject 20, version-flow 10).`);
