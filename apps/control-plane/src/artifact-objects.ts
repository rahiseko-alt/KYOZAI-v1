type ArtifactObjectRow = { storage_bucket: "kyozai-sources" | "kyozai-artifacts"; storage_path: string; media_type: string; byte_size: number };

export class ArtifactObjectError extends Error { constructor(readonly code: "NOT_FOUND" | "CONFLICT") { super(code); } }

function artifactId(pathname: string) {
  const match = pathname.match(/^\/internal\/v1\/artifacts\/([^/]+)\/bytes$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

async function artifact(db: D1Database, id: string, lifecycle: "draft" | "validated" | "final") {
  const row = await db.prepare("SELECT storage_bucket, storage_path, media_type, byte_size FROM artifacts WHERE id = ? AND lifecycle = ?")
    .bind(id, lifecycle).first<ArtifactObjectRow>();
  if (!row) throw new ArtifactObjectError("NOT_FOUND");
  return row;
}

async function readableArtifact(db: D1Database, id: string) {
  const row = await db.prepare("SELECT storage_bucket, storage_path, media_type, byte_size FROM artifacts WHERE id = ? AND lifecycle IN ('draft', 'validated', 'final')")
    .bind(id).first<ArtifactObjectRow>();
  if (!row) throw new ArtifactObjectError("NOT_FOUND");
  return row;
}

function bucket(row: ArtifactObjectRow, source: R2Bucket, artifacts: R2Bucket) {
  return row.storage_bucket === "kyozai-sources" ? source : artifacts;
}

export async function putArtifactBytes(request: Request, db: D1Database, source: R2Bucket, artifacts: R2Bucket) {
  const id = artifactId(new URL(request.url).pathname);
  if (!id || !request.body) throw new ArtifactObjectError("CONFLICT");
  const row = await artifact(db, id, "draft");
  const target = bucket(row, source, artifacts);
  await target.put(row.storage_path, request.body, { httpMetadata: { contentType: row.media_type } });
  const head = await target.head(row.storage_path);
  if (!head || head.size !== row.byte_size) throw new ArtifactObjectError("CONFLICT");
  return { artifactId: id, byteSize: head.size };
}

export async function getArtifactBytes(request: Request, db: D1Database, source: R2Bucket, artifacts: R2Bucket) {
  const id = artifactId(new URL(request.url).pathname);
  if (!id) throw new ArtifactObjectError("NOT_FOUND");
  // The caller is the Vercel Workflow authenticated with the control-plane token.
  // It must read draft bytes to calculate the readback SHA-256 before validation.
  const row = await readableArtifact(db, id);
  const object = await bucket(row, source, artifacts).get(row.storage_path);
  if (!object) throw new ArtifactObjectError("NOT_FOUND");
  return new Response(object.body, { headers: { "Content-Type": row.media_type, "Content-Length": String(object.size), "Cache-Control": "no-store" } });
}
