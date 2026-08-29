export type OpenAiResponsePayload = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

export type OpenAiStreamFailureKind = "missing_body" | "timeout" | "invalid_event" | "event_error" | "read_failure";

export class OpenAiStreamError extends Error {
  constructor(readonly kind: OpenAiStreamFailureKind) {
    super(`OpenAI stream ${kind}`);
    this.name = "OpenAiStreamError";
  }
}

type StreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  response?: OpenAiResponsePayload;
  error?: { message?: string };
};

export async function streamingOutput(response: Response, timeoutMs: number): Promise<{ payload: OpenAiResponsePayload; raw: string }> {
  if (!response.body) throw new OpenAiStreamError("missing_body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let finalText = "";
  let payload: OpenAiResponsePayload = { status: "in_progress" };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new OpenAiStreamError("timeout")), timeoutMs);
  });

  const consumeEvent = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;

    let event: StreamEvent;
    try {
      event = JSON.parse(data) as StreamEvent;
    } catch {
      throw new OpenAiStreamError("invalid_event");
    }
    if (event.type === "response.output_text.delta") raw += event.delta ?? "";
    if (event.type === "response.output_text.done") finalText = event.text ?? raw;
    if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
      payload = event.response ?? payload;
    }
    if (event.type === "error") throw new OpenAiStreamError("event_error");
  };

  try {
    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await Promise.race([reader.read(), timeoutResult]);
      } catch (error) {
        if (error instanceof OpenAiStreamError) throw error;
        throw new OpenAiStreamError("read_failure");
      }
      const { done, value } = read;
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        consumeEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) consumeEvent(buffer);
    return { payload, raw: finalText || raw };
  } finally {
    if (timeout) clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
  }
}
