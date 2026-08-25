import { describe, expect, it } from "vitest";

import { loadDurableSources } from "../lib/kyozai/durable-source";

const jobId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";

function fixturePdf(pageCount: number) {
  const pageIds = Array.from({ length: pageCount }, (_, index) => index + 3);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...pageIds.map(() => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Blob([pdf], { type: "application/pdf" });
}

function attachmentSupabase(blob: Blob, mediaType = "application/pdf") {
  return {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{ id: attachmentId, storage_path: "owner/file/original.pdf", media_type: mediaType, consumed_by_job_id: jobId }], error: null }),
      }),
    }),
    storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) },
  } as never;
}

describe("durable worker source loading", () => {
  it("rehydrates an owned private text attachment without browser state", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          in: async () => ({ data: [{ id: attachmentId, storage_path: "owner/file/original.txt", media_type: "text/plain", consumed_by_job_id: jobId }], error: null }),
        }),
      }),
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob(["durable attachment body"]), error: null }),
        }),
      },
    } as never;

    await expect(loadDurableSources(jobId, { sourceText: "direct", attachmentIds: [attachmentId] }, supabase))
      .resolves.toEqual([
        { type: "input_text", text: "入力テキスト:\ndirect" },
        { type: "input_text", text: `ファイル: attachment-${attachmentId}.txt\ndurable attachment body` },
      ]);
  });

  it("rejects an attachment that was not consumed by this job", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          in: async () => ({ data: [{ id: attachmentId, storage_path: "owner/file/original.txt", media_type: "text/plain", consumed_by_job_id: null }], error: null }),
        }),
      }),
      storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) },
    } as never;

    await expect(loadDurableSources(jobId, { attachmentIds: [attachmentId] }, supabase)).rejects.toThrow("durable_attachment_not_owned_by_job");
  });

  it("rejects a PDF whose magic bytes do not match its persisted MIME type", async () => {
    await expect(loadDurableSources(jobId, { attachmentIds: [attachmentId] }, attachmentSupabase(new Blob(["not a PDF"]))))
      .rejects.toThrow("durable_attachment_pdf_invalid");
  });

  it("accepts a private PDF with no more than 30 pages", async () => {
    await expect(loadDurableSources(jobId, { attachmentIds: [attachmentId] }, attachmentSupabase(fixturePdf(30))))
      .resolves.toHaveLength(1);
  });

  it("rejects a private PDF with more than 30 pages before model input", async () => {
    await expect(loadDurableSources(jobId, { attachmentIds: [attachmentId] }, attachmentSupabase(fixturePdf(31))))
      .rejects.toThrow("durable_attachment_pdf_too_many_pages");
  });
});
