import { randomUUID } from "node:crypto";

export type PublicErrorCode =
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_FAILURE"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT";

export class PublicHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: PublicErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PublicHttpError";
  }
}

export function badRequest(message: string) {
  return new PublicHttpError(400, "BAD_REQUEST", message);
}

export function payloadTooLarge(message: string) {
  return new PublicHttpError(413, "PAYLOAD_TOO_LARGE", message);
}

export function routeUnavailable() {
  return new PublicHttpError(404, "NOT_FOUND", "この機能は公開されていません。");
}

export function publicErrorResponse(error: unknown, fallback: string) {
  const requestId = randomUUID();
  const known = error instanceof PublicHttpError
    ? error
    : new PublicHttpError(502, "UPSTREAM_FAILURE", fallback);
  if (!(error instanceof PublicHttpError)) {
    const safeName = error instanceof Error ? error.name : typeof error;
    console.error(JSON.stringify({ requestId, code: known.code, errorType: safeName }));
  }
  const headers = known.retryAfterSeconds ? { "Retry-After": String(known.retryAfterSeconds) } : undefined;
  return Response.json({
    error: known.message,
    code: known.code,
    requestId,
    ...(known.retryAfterSeconds ? { retryAfterSeconds: known.retryAfterSeconds } : {}),
  }, { status: known.status, headers });
}
