import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../../supabase/migrations/20260825161000_kyozai_revision_lineage.sql", import.meta.url), "utf8");

describe("immutable revision lineage", () => {
  it("creates a candidate only from the active completed base and retains final artifacts by reference", () => {
    expect(migration).toContain("revision_artifact_refs");
    expect(migration).toContain("v_job.active_revision_number <> p_base_revision_number");
    expect(migration).toContain("raise exception using errcode = '40001', message = 'revision conflict'");
    expect(migration).toContain("lifecycle = 'final'");
    expect(migration).toContain("'inherited'");
    expect(migration).not.toContain("update public.artifacts set revision_id");
  });
});
