import { describe, expect, it } from "vitest";

import {
  KYOZAI_JOB_STAGES,
  canTransitionJobStatus,
  isKyozaiJobStage,
  isTerminalJobStatus,
} from "../../../shared/kyozai-job-contract";
import { readSupabasePublicConfig, readSupabaseServerConfig } from "../lib/supabase/config";

describe("永続job契約", () => {
  it("Skill工程と同じstageを固定する", () => {
    expect(KYOZAI_JOB_STAGES).toEqual([
      "source_ingest", "analysis", "slide_map", "script_timing", "content_freeze",
      "design", "image_generate", "image_validate", "package", "revision",
    ]);
    expect(isKyozaiJobStage("content_freeze")).toBe(true);
    expect(isKyozaiJobStage("finalize")).toBe(false);
  });

  it("終了jobを再開せず、キャンセルをstage境界へ限定する", () => {
    expect(canTransitionJobStatus("queued", "running")).toBe(true);
    expect(canTransitionJobStatus("running", "cancelling")).toBe(true);
    expect(canTransitionJobStatus("cancelling", "cancelled")).toBe(true);
    expect(canTransitionJobStatus("completed", "running")).toBe(false);
    expect(isTerminalJobStatus("cancelled")).toBe(true);
  });

  it("Supabase設定は必要な値が不足すれば停止する", () => {
    expect(() => readSupabasePublicConfig({})).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(() => readSupabaseServerConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-placeholder",
    })).toThrow("SUPABASE_SERVICE_ROLE_KEY");
    expect(readSupabaseServerConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-placeholder",
      SUPABASE_SERVICE_ROLE_KEY: "server-placeholder",
    }).url).toBe("https://example.supabase.co");
  });
});
