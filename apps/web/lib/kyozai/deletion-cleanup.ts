import { randomUUID } from "node:crypto";

import { createServerSupabaseClient } from "../supabase/server";

type ClaimedDeletion = { job_id: string; source_paths: string[]; artifact_paths: string[] };

function claimed(value: unknown): ClaimedDeletion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.job_id !== "string" || !Array.isArray(row.source_paths) || !Array.isArray(row.artifact_paths)) return undefined;
  if (![...row.source_paths, ...row.artifact_paths].every((path) => typeof path === "string")) return undefined;
  return row as ClaimedDeletion;
}

/** Removes one logically deleted job from private storage, then atomically closes it. */
export async function runOneDeletionCleanup() {
  const supabase = createServerSupabaseClient();
  const leaseOwner = `cleanup-${randomUUID()}`;
  const { data, error } = await supabase.rpc("claim_kyozai_deletion_cleanup", { p_lease_owner: leaseOwner });
  if (error) throw new Error("deletion_cleanup_claim_failed");
  const row = claimed(Array.isArray(data) ? data[0] : data);
  if (!row) return { claimed: false as const };
  const removals = await Promise.all([
    row.source_paths.length ? supabase.storage.from("kyozai-sources").remove(row.source_paths) : Promise.resolve({ error: null }),
    row.artifact_paths.length ? supabase.storage.from("kyozai-artifacts").remove(row.artifact_paths) : Promise.resolve({ error: null }),
  ]);
  if (removals.some((result) => result.error)) throw new Error("deletion_cleanup_storage_failed");
  const { data: completed, error: completionError } = await supabase.rpc("complete_kyozai_deletion_cleanup", { p_job_id: row.job_id, p_lease_owner: leaseOwner });
  if (completionError || completed !== true) throw new Error("deletion_cleanup_completion_failed");
  return { claimed: true as const, jobId: row.job_id };
}
