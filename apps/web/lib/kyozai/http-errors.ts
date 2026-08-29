import { randomUUID } from "node:crypto";

import { ImagePipelineError, type ImagePipelineDiagnostic } from "./image-pipeline-error";

export type PublicErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
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
    readonly diagnostic?: ImagePipelineDiagnostic,
  ) {
    super(message);
    this.name = "PublicHttpError";
  }
}

export function badRequest(message: string) {
  return new PublicHttpError(400, "BAD_REQUEST", message);
}

export function unauthorized(message = "ログインが必要です。") {
  return new PublicHttpError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "この操作は許可されていません。") {
  return new PublicHttpError(403, "FORBIDDEN", message);
}

export function conflict(message: string) {
  return new PublicHttpError(409, "CONFLICT", message);
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
  const diagnostic = error instanceof ImagePipelineError ? error.diagnostic : known.diagnostic;
  if (!(error instanceof PublicHttpError) || diagnostic) {
    const safeName = error instanceof Error ? error.name : typeof error;
    console.error(JSON.stringify({ requestId, code: known.code, errorType: safeName, ...(diagnostic ?? {}) }));
  }
  const headers = known.retryAfterSeconds ? { "Retry-After": String(known.retryAfterSeconds) } : undefined;
  return Response.json({
    error: known.message,
    code: known.code,
    requestId,
    ...(diagnostic ? { stage: diagnostic.stage } : {}),
    ...(known.retryAfterSeconds ? { retryAfterSeconds: known.retryAfterSeconds } : {}),
  }, { status: known.status, headers });
}
