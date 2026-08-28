import { describe, expect, it } from "vitest";

import { snapshotFromRows } from "../lib/kyozai/job-store";

describe("Cloudflare job snapshot decoding", () => {
  it("decodes D1 JSON ledger columns without exposing malformed values", () => {
    const snapshot = snapshotFromRows(
      { id: "job-1", status: "running", current_stage: "analysis", active_revision_number: 1, error_code: null },
      { id: "revision-1", revision_number: 1, status: "running" },
      [{ stage: "analysis", status: "passed", attempt: 0, slide_number: 0, input_artifact_ids_json: '["source-1"]', output_artifact_ids_json: '["analysis-1"]', validator: "fixture", usage_json: '{"inputTokens":12}' }],
      [{ id: "artifact-1", kind: "analysis", lifecycle: "final", storage_path: "jobs/job-1/analysis.json", sha256: "a".repeat(64), media_type: "application/json", byte_size: 12, slide_number: null }],
    );

    expect(snapshot).toMatchObject({
      id: "job-1", status: "running", currentStage: "analysis", revision: 1,
      stages: [{ stage: "analysis", inputArtifactIds: ["source-1"], outputArtifactIds: ["analysis-1"], usage: { inputTokens: 12 } }],
      artifacts: [{ artifactId: "artifact-1", storagePath: "jobs/job-1/analysis.json", status: "final" }],
    });
  });

  it("drops malformed D1 JSON ledger columns instead of inventing artifact references", () => {
    const snapshot = snapshotFromRows(
      { id: "job-1", status: "queued", active_revision_number: 1 },
      { id: "revision-1", revision_number: 1, status: "queued" },
      [{ stage: "analysis", status: "pending", attempt: 0, input_artifact_ids_json: "not-json", output_artifact_ids_json: '["ok",3]', validator: "fixture", usage_json: "not-json" }],
      [],
    );

    expect(snapshot.stages[0]).toMatchObject({ inputArtifactIds: [], outputArtifactIds: [] });
    expect(snapshot.stages[0]?.usage).toBeUndefined();
  });
});
