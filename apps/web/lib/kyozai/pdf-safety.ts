const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const PDF_PARSE_TIMEOUT_MS = 10_000;

export const pdfLimits = {
  maxBytes: MAX_PDF_BYTES,
  maxPages: MAX_PDF_PAGES,
} as const;

export class PdfInputError extends Error {
  constructor(readonly code: "pdf_invalid" | "pdf_too_large" | "pdf_too_many_pages" | "pdf_parse_timeout") {
    super(`durable_attachment_${code}`);
  }
}

export function assertPdfMagic(bytes: Buffer) {
  if (bytes.length > MAX_PDF_BYTES) throw new PdfInputError("pdf_too_large");
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new PdfInputError("pdf_invalid");
}

/**
 * Page-tree parsing is deliberately performed before a PDF is sent to a model.
 * `pdfjs-dist` reads the actual page tree (including object streams), unlike a
 * token count, and no page content is rendered or extracted here.
 */
export async function assertSafePdf(bytes: Buffer) {
  assertPdfMagic(bytes);

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    stopAtErrors: true,
    useWorkerFetch: false,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const dispose = () => {
    if (destroyed) return;
    destroyed = true;
    void loadingTask.destroy().catch(() => undefined);
  };
  try {
    const document = await Promise.race([
      loadingTask.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          dispose();
          reject(new PdfInputError("pdf_parse_timeout"));
        }, PDF_PARSE_TIMEOUT_MS);
      }),
    ]);
    if (document.numPages > MAX_PDF_PAGES) throw new PdfInputError("pdf_too_many_pages");
  } catch (error) {
    if (error instanceof PdfInputError) throw error;
    throw new PdfInputError("pdf_invalid");
  } finally {
    if (timer) clearTimeout(timer);
    // pdf.js worker teardown can wait for its idle timeout. The task owns no
    // rendered pages, so start teardown without delaying the job lease.
    dispose();
  }
}
