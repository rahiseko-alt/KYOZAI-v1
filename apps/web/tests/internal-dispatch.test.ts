import { describe, expect, it } from "vitest";

import { isAuthorizedCronRequest, isInternalDispatchAvailable } from "../lib/kyozai/internal-dispatch";
import { isBusyStageError, isWorkflowTerminalStatus } from "../lib/kyozai/job-workflow";

describe("内部Cron dispatch境界", () => {
  const secret = "a-test-only-secret-that-is-long-enough";

  it("正しいBearer secretだけを受け入れる", () => {
    const env = { CRON_SECRET: secret, VERCEL_ENV: "preview" };
    expect(isAuthorizedCronRequest(new Request("https://example.test"), env)).toBe(false);
    expect(isAuthorizedCronRequest(new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }), env)).toBe(false);
    expect(isAuthorizedCronRequest(new Request("https://example.test", { headers: { authorization: `Bearer ${secret}` } }), env)).toBe(true);
  });

  it("Productionでは正しいsecretを持つ内部Cronだけを有効にする", () => {
    expect(isInternalDispatchAvailable({ CRON_SECRET: secret, VERCEL_ENV: "production" })).toBe(true);
    expect(isInternalDispatchAvailable({ CRON_SECRET: secret, VERCEL_ENV: "preview" })).toBe(true);
    expect(isInternalDispatchAvailable({ VERCEL_ENV: "preview" })).toBe(false);
  });

  it("終端jobをworkerが再実行しない対象として判定する", () => {
    expect(isWorkflowTerminalStatus("completed")).toBe(true);
    expect(isWorkflowTerminalStatus("failed")).toBe(true);
    expect(isWorkflowTerminalStatus("cancelled")).toBe(true);
    expect(isWorkflowTerminalStatus("running")).toBe(false);
    expect(isWorkflowTerminalStatus("queued")).toBe(false);
  });

  it("他workerが保持するstageはjob失敗ではなく再試行対象にする", () => {
    expect(isBusyStageError(new Error("image_generation_stage_busy"))).toBe(true);
    expect(isBusyStageError(new Error("workflow_artifact_download_failed"))).toBe(false);
  });
});
