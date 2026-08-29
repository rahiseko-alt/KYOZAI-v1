export type OpenAiResponsePayload = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

type StreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  response?: OpenAiResponsePayload;
  error?: { message?: string };
};

export async function streamingOutput(response: Response, timeoutMs: number): Promise<{ payload: OpenAiResponsePayload; raw: string }> {
  if (!response.body) throw new Error("OpenAI stream did not include a body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let finalText = "";
  let payload: OpenAiResponsePayload = { status: "in_progress" };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("OpenAI stream timed out")), timeoutMs);
  });

  const consumeEvent = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;

    const event = JSON.parse(data) as StreamEvent;
    if (event.type === "response.output_text.delta") raw += event.delta ?? "";
    if (event.type === "response.output_text.done") finalText = event.text ?? raw;
    if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
      payload = event.response ?? payload;
    }
    if (event.type === "error") throw new Error("OpenAI streaming error");
  };

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeoutResult]);
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
