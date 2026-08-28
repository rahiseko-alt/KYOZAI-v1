export type ArtifactCommand =
  | { command: "register"; artifactId: string; jobId: string; revisionId: string; kind: string; storageBucket: "kyozai-sources" | "kyozai-artifacts"; storagePath: string; mediaType: string; byteSize: number; metadataJson: string; now: string }
  | { command: "read"; artifactId: string }
  | { command: "validate"; artifactId: string; sha256: string }
  | { command: "finalize"; jobId: string; revisionId: string; artifactIds: string[]; now: string };

export class ArtifactCommandError extends Error { constructor(readonly code: "BAD_COMMAND" | "CONFLICT") { super(code); } }
const text = (value: unknown) => { if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new ArtifactCommandError("BAD_COMMAND"); return value.trim(); };
const idList = (value: unknown) => { if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== "string" || !id.trim())) throw new ArtifactCommandError("BAD_COMMAND"); return value.map((id) => id.trim()); };

export function parseArtifactCommand(value: unknown): ArtifactCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ArtifactCommandError("BAD_COMMAND"); const x = value as Record<string, unknown>;
  if (x.command === "register") { if ((x.storageBucket !== "kyozai-sources" && x.storageBucket !== "kyozai-artifacts") || typeof x.byteSize !== "number" || !Number.isInteger(x.byteSize) || x.byteSize < 0) throw new ArtifactCommandError("BAD_COMMAND"); const metadataJson = text(x.metadataJson); try { JSON.parse(metadataJson); } catch { throw new ArtifactCommandError("BAD_COMMAND"); } return { command: "register", artifactId: text(x.artifactId), jobId: text(x.jobId), revisionId: text(x.revisionId), kind: text(x.kind), storageBucket: x.storageBucket, storagePath: text(x.storagePath), mediaType: text(x.mediaType), byteSize: x.byteSize, metadataJson, now: text(x.now) }; }
  if (x.command === "read") return { command: "read", artifactId: text(x.artifactId) };
  if (x.command === "validate") { const sha256 = text(x.sha256); if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new ArtifactCommandError("BAD_COMMAND"); return { command: "validate", artifactId: text(x.artifactId), sha256 }; }
  if (x.command === "finalize") return { command: "finalize", jobId: text(x.jobId), revisionId: text(x.revisionId), artifactIds: idList(x.artifactIds), now: text(x.now) };
  throw new ArtifactCommandError("BAD_COMMAND");
}

export async function executeArtifactCommand(db: D1Database, x: ArtifactCommand) {
  if (x.command === "register") {
    const result = await db.prepare("INSERT INTO artifacts (id, job_id, revision_id, kind, lifecycle, storage_bucket, storage_path, media_type, byte_size, metadata_json, created_at) SELECT ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM job_revisions WHERE id = ? AND job_id = ?)").bind(x.artifactId, x.jobId, x.revisionId, x.kind, x.storageBucket, x.storagePath, x.mediaType, x.byteSize, x.metadataJson, x.now, x.revisionId, x.jobId).run();
    if (result.meta.changes !== 1) throw new ArtifactCommandError("CONFLICT"); return { artifactId: x.artifactId };
  }
  if (x.command === "read") {
    const artifact = await db.prepare("SELECT id, job_id, revision_id, kind, lifecycle, storage_path, media_type, byte_size, sha256, slide_number, metadata_json FROM artifacts WHERE id = ? AND lifecycle IN ('draft', 'validated', 'final')")
      .bind(x.artifactId).first<Record<string, unknown>>();
    if (!artifact) throw new ArtifactCommandError("CONFLICT");
    try { return { artifact: { ...artifact, metadata: JSON.parse(String(artifact.metadata_json ?? "{}")) } }; } catch { throw new ArtifactCommandError("CONFLICT"); }
  }
  if (x.command === "validate") {
    const result = await db.prepare("UPDATE artifacts SET lifecycle = 'validated', sha256 = ? WHERE id = ? AND lifecycle = 'draft'").bind(x.sha256.toLowerCase(), x.artifactId).run();
    if (result.meta.changes !== 1) throw new ArtifactCommandError("CONFLICT"); return { artifactId: x.artifactId };
  }
  if (!x.artifactIds.length) return { finalized: 0 };
  const placeholders = x.artifactIds.map(() => "?").join(", ");
  const result = await db.prepare(`UPDATE artifacts SET lifecycle = 'final', finalized_at = ? WHERE id IN (${placeholders}) AND job_id = ? AND revision_id = ? AND lifecycle = 'validated' AND sha256 IS NOT NULL`).bind(x.now, ...x.artifactIds, x.jobId, x.revisionId).run();
  if (result.meta.changes !== x.artifactIds.length) throw new ArtifactCommandError("CONFLICT"); return { finalized: result.meta.changes };
}
