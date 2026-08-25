import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../workflows/kyozai-job-workflow.ts", import.meta.url), "utf8");

describe("Vercel Workflow durable worker boundary", () => {
  it("compiles Workflow SDK directives through Next.js", () => {
    expect(nextConfig).toContain('import { withWorkflow } from "workflow/next"');
    expect(nextConfig).toContain("export default withWorkflow(nextConfig)");
  });

  it("keeps external worker work inside a durable step", () => {
    expect(workflow).toContain('"use workflow"');
    expect(workflow).toContain('"use step"');
    expect(workflow).toContain('await import("../lib/kyozai/job-workflow")');
    expect(workflow).toContain('await import("../lib/kyozai/internal-dispatch")');
  });
});
