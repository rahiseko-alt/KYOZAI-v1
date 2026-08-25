import { describe, expect, it } from "vitest";

import { loadDurableSources } from "../lib/kyozai/durable-source";

const jobId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";

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
});
