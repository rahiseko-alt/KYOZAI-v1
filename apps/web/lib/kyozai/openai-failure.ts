export class OpenAiPreResponseConnectionError extends Error {
  constructor(readonly cause: unknown) {
    super("openai_pre_response_connection_failed");
    this.name = "OpenAiPreResponseConnectionError";
  }
}

function safeConnectionCode(value: unknown) {
  if (!value || typeof value !== "object" || !("code" in value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : undefined;
}

export function preResponseConnectionDetails(error: unknown) {
  if (!(error instanceof OpenAiPreResponseConnectionError)) return undefined;
  const cause = error.cause;
  const name = cause instanceof Error && /^[A-Za-z0-9_]{1,64}$/.test(cause.name) ? cause.name : "unknown";
  return { name, code: safeConnectionCode(cause) ?? (cause instanceof Error ? safeConnectionCode(cause.cause) : undefined) };
}
