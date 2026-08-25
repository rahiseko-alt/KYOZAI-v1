import type { SupabaseClient } from "@supabase/supabase-js";

import { readUrl } from "./source";
import { assertSafePdf, pdfLimits } from "./pdf-safety";
import type { SourceInput } from "./types";

const SOURCE_BUCKET = "kyozai-sources";
const MAX_SOURCE_TEXT_CHARS = 80_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const acceptedAttachmentMediaTypes = new Set(["application/pdf", "text/plain", "text/markdown"]);

type DurableRequest = {
  sourceText?: unknown;
  sourceUrl?: unknown;
  attachmentIds?: unknown;
};

type UploadRow = {
  id: string;
  storage_path: string;
  media_type: "application/pdf" | "text/plain" | "text/markdown";
  consumed_by_job_id: string | null;
};

function attachmentIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 2 || value.some((id) => typeof id !== "string" || !uuid.test(id))) {
    throw new Error("durable_attachment_ids_invalid");
  }
  return value;
}

function attachmentName(row: UploadRow) {
  const suffix = row.media_type === "application/pdf" ? "pdf" : row.media_type === "text/markdown" ? "md" : "txt";
  return `attachment-${row.id}.${suffix}`;
}

/**
 * Rehydrates the accepted private inputs inside the worker. This is deliberately
 * separate from request handling: a job never depends on browser memory after 202.
 */
export async function loadDurableSources(
  jobId: string,
  request: DurableRequest,
  supabase: Pick<SupabaseClient, "from" | "storage">,
  deadlineMs = Date.now() + 120_000,
): Promise<SourceInput[]> {
  const sources: SourceInput[] = [];
  const directText = typeof request.sourceText === "string" ? request.sourceText.trim() : "";
  if (directText) sources.push({ type: "input_text", text: `入力テキスト:\n${directText.slice(0, MAX_SOURCE_TEXT_CHARS)}` });

  const rawUrl = typeof request.sourceUrl === "string" ? request.sourceUrl.trim() : "";
  if (rawUrl) {
    const text = await readUrl(rawUrl, deadlineMs);
    if (!text) throw new Error("durable_url_empty");
    sources.push({ type: "input_text", text: `参照URL: ${rawUrl}\n${text.slice(0, MAX_SOURCE_TEXT_CHARS)}` });
  }

  const ids = attachmentIds(request.attachmentIds ?? []);
  if (ids.length) {
    const { data, error } = await supabase.from("upload_sessions")
      .select("id, storage_path, media_type, consumed_by_job_id")
      .in("id", ids);
    if (error || !data || data.length !== ids.length) throw new Error("durable_attachment_not_found");
    const rows = data as UploadRow[];
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || row.consumed_by_job_id !== jobId) throw new Error("durable_attachment_not_owned_by_job");
      if (!acceptedAttachmentMediaTypes.has(row.media_type)) throw new Error("durable_attachment_media_type_invalid");
      const { data: blob, error: downloadError } = await supabase.storage.from(SOURCE_BUCKET).download(row.storage_path);
      if (downloadError || !blob) throw new Error("durable_attachment_download_failed");
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (bytes.length > pdfLimits.maxBytes) throw new Error("durable_attachment_too_large");
      if (row.media_type === "application/pdf") {
        await assertSafePdf(bytes);
        sources.push({ type: "input_file", filename: attachmentName(row), file_data: `data:application/pdf;base64,${bytes.toString("base64")}` });
      } else {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0")) throw new Error("durable_attachment_text_invalid");
        sources.push({ type: "input_text", text: `ファイル: ${attachmentName(row)}\n${text.slice(0, MAX_SOURCE_TEXT_CHARS)}` });
      }
    }
  }
  if (!sources.length) throw new Error("durable_source_not_available");
  return sources;
}
