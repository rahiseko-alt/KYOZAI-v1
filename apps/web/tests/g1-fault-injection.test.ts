import { describe, expect, it } from "vitest";

import { injectG1Fault } from "../lib/kyozai/g1-fault-injection";

describe("G1故障注入境界", () => {
  const enabledPreview = {
    VERCEL_ENV: "preview",
    KYOZAI_G1_FAULT_INJECTION_ENABLED: "1",
  };

  it("Productionでは設定値が残っても故障を注入しない", () => {
    expect(() => injectG1Fault("provider_response_received", {}, {
      ...enabledPreview,
      VERCEL_ENV: "production",
      KYOZAI_G1_FAULT_POINT: "provider_response_received",
    })).not.toThrow();
  });

  it("provider応答直後を結果不明として停止できる", () => {
    expect(() => injectG1Fault("provider_response_received", {}, {
      ...enabledPreview,
      KYOZAI_G1_FAULT_POINT: "provider_response_received",
    })).toThrow("fault_injected:provider_response_received");
  });

  it("checkpoint保存直後は回収可能なretry理由で停止する", () => {
    expect(() => injectG1Fault("provider_checkpoint_saved", {}, {
      ...enabledPreview,
      KYOZAI_G1_FAULT_POINT: "provider_checkpoint_saved",
    })).toThrow("provider_checkpoint_fault_injected");
  });

  it("stage pass直前は初回attemptだけ停止し、retryを通す", () => {
    const env = { ...enabledPreview, KYOZAI_G1_FAULT_POINT: "before_stage_pass" };
    expect(() => injectG1Fault("before_stage_pass", { stageAttempt: 0 }, env)).toThrow("fault_injected:before_stage_pass");
    expect(() => injectG1Fault("before_stage_pass", { stageAttempt: 1 }, env)).not.toThrow();
  });
});
