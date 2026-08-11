import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;
const MAX_SKILL_LINES = 500;
const ALLOWED_FRONTMATTER_KEYS = new Set(["name", "description"]);

function fail(message) {
  throw new Error(message);
}

function parseFrontmatter(content, source) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    fail(`${source}: missing YAML frontmatter`);
  }

  const fields = new Map();
  for (const rawLine of match[1].split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const separator = rawLine.indexOf(":");
    if (separator < 1) {
      fail(`${source}: invalid frontmatter line: ${rawLine}`);
    }
    const key = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1).trim();
    if (!ALLOWED_FRONTMATTER_KEYS.has(key)) {
      fail(`${source}: unsupported frontmatter key: ${key}`);
    }
    if (fields.has(key)) {
      fail(`${source}: duplicate frontmatter key: ${key}`);
    }
    fields.set(key, value.replace(/^['"]|['"]$/g, ""));
  }

  return fields;
}

function assertCleanUtf8(content, source) {
  if (content.includes("\uFFFD")) {
    fail(`${source}: invalid UTF-8 replacement character found`);
  }
}

async function validateSkill(skillsRoot, entry) {
  const skillDir = path.join(skillsRoot, entry.name);
  const skillPath = path.join(skillDir, "SKILL.md");
  const agentPath = path.join(skillDir, "agents", "openai.yaml");
  const skill = await readFile(skillPath, "utf8");
  const agent = await readFile(agentPath, "utf8");

  assertCleanUtf8(skill, skillPath);
  assertCleanUtf8(agent, agentPath);

  const fields = parseFrontmatter(skill, skillPath);
  const name = fields.get("name");
  const description = fields.get("description");

  if (!name || !description) {
    fail(`${skillPath}: name and description are required`);
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    fail(`${skillPath}: invalid skill name: ${name}`);
  }
  if (name !== entry.name) {
    fail(`${skillPath}: skill name must match folder name`);
  }
  if (description.length < 20) {
    fail(`${skillPath}: description is too short`);
  }
  if (!skill.includes("\n# ")) {
    fail(`${skillPath}: top-level heading is required`);
  }
  if (skill.split(/\r?\n/).length > MAX_SKILL_LINES) {
    fail(`${skillPath}: exceeds ${MAX_SKILL_LINES} lines`);
  }
  if (!agent.includes(`$${name}`)) {
    fail(`${agentPath}: default_prompt must mention $${name}`);
  }
  if (!/display_name:\s*"[^"]+"/.test(agent)) {
    fail(`${agentPath}: display_name is required`);
  }
  if (!/short_description:\s*"[^"]+"/.test(agent)) {
    fail(`${agentPath}: short_description is required`);
  }
  if (/C:[\\/]Users[\\/][^.{][^\\/]*[\\/]/i.test(skill + agent)) {
    fail(`${skillDir}: machine-specific user path found`);
  }

  return name;
}

async function main() {
  const skillsRoot = path.resolve(process.cwd(), ".agents", "skills");
  const entries = (await readdir(skillsRoot, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory(),
  );
  if (entries.length === 0) {
    fail(`${skillsRoot}: no skill directories found`);
  }

  const validated = [];
  for (const entry of entries) {
    validated.push(await validateSkill(skillsRoot, entry));
  }
  console.log(`Validated ${validated.length} skill(s): ${validated.join(", ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
