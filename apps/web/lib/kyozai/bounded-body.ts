import { PublicHttpError, badRequest, payloadTooLarge } from "./http-errors";

export async function readBoundedBytes(request: Request, maximumBytes: number, message: string): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw payloadTooLarge(message);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw payloadTooLarge(message);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readBoundedText(request: Request, maximumBytes: number, message: string): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBytes(request, maximumBytes, message));
  } catch (error) {
    if (error instanceof PublicHttpError) throw error;
    throw badRequest("リクエスト本文をUTF-8として読み取れませんでした。");
  }
}

export async function readBoundedFormData(request: Request, maximumBytes: number, message: string): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) throw new PublicHttpError(415, "UNSUPPORTED_MEDIA_TYPE", "multipart/form-dataで送信してください。");
  const bytes = await readBoundedBytes(request, maximumBytes, message);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Request("http://local.invalid", { method: "POST", headers: { "Content-Type": contentType }, body: copy.buffer }).formData();
}
