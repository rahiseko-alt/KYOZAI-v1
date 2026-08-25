import { createHmac, createHash } from "node:crypto";

import { PublicHttpError } from "./http-errors";

export type RateLimitPolicy = "generate" | "revise" | "render-slide";

type Scope = { renderGrant?: string; slideNumber?: number };
type Bucket = { key: string; limit: number; windowMs: number };

const FIFTEEN_MINUTES = 15 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;
const E2E_ID_SECRET = "kyozai-e2e-rate-limit-id-secret-32-bytes-minimum";
const ACTOR_LIMITS: Record<RateLimitPolicy, number> = { generate: 3, revise: 8, "render-slide": 24 };
const GLOBAL_LIMITS: Record<RateLimitPolicy, number> = { generate: 30, revise: 80, "render-slide": 120 };
const localWindows = new Map<string, { count: number; expiresAt: number }>();
const MAX_LOCAL_BUCKETS = 1_000;

const REDIS_SCRIPT = `
local results = {}
for index, key in ipairs(KEYS) do
  local count = redis.call("INCR", key)
  if count == 1 then redis.call("PEXPIRE", key, ARGV[index * 2 - 1]) end
  results[index] = count
end
for index, key in ipairs(KEYS) do
  results[#KEYS + index] = redis.call("PTTL", key)
end
return results
`;

export class RateLimitError extends PublicHttpError {
  constructor(
    message: string,
    status: 429 | 503,
    code: "RATE_LIMITED" | "SERVICE_UNAVAILABLE",
    retryAfterSeconds?: number,
  ) {
    super(status, code, message, retryAfterSeconds);
    this.name = "RateLimitError";
  }
}

function isVercel() {
  return process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
}

function localMode() {
  return !isVercel() || (process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production");
}

function idSecret() {
  if (process.env.KYOZAI_E2E_MODE === "1" && process.env.VERCEL_ENV !== "production") return E2E_ID_SECRET;
  const value = process.env.KYOZAI_RATE_LIMIT_ID_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) throw unavailable();
  return value;
}

function unavailable() {
  return new RateLimitError("現在、生成回数を安全に確認できません。時間を置いてお試しください。", 503, "SERVICE_UNAVAILABLE");
}

function limited(retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  return new RateLimitError("利用上限に達しました。時間を置いてお試しください。", 429, "RATE_LIMITED", seconds);
}

function digest(value: string, secret = idSecret()) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function actorAddress(request: Request) {
  if (localMode()) return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const value = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (!value) throw unavailable();
  return value;
}

function buckets(request: Request, policy: RateLimitPolicy, scope?: Scope): Bucket[] {
  const actor = digest(actorAddress(request));
  const values: Bucket[] = [
    { key: `kyozai:rate:${policy}:actor:${actor}`, limit: ACTOR_LIMITS[policy], windowMs: FIFTEEN_MINUTES },
    { key: `kyozai:rate:${policy}:global`, limit: GLOBAL_LIMITS[policy], windowMs: ONE_DAY },
  ];
  if (policy === "render-slide" && scope?.renderGrant && Number.isInteger(scope.slideNumber)) {
    const grant = createHash("sha256").update(scope.renderGrant).digest("hex");
    values.push({ key: `kyozai:rate:render-slide:grant:${grant}:${scope.slideNumber}`, limit: 2, windowMs: FIFTEEN_MINUTES });
  }
  return values;
}

function pruneLocal(now: number) {
  for (const [key, value] of localWindows) if (value.expiresAt <= now) localWindows.delete(key);
  while (localWindows.size >= MAX_LOCAL_BUCKETS) localWindows.delete(localWindows.keys().next().value as string);
}

function consumeLocal(values: Bucket[]) {
  const now = Date.now();
  pruneLocal(now);
  let retryAfterMs = 0;
  for (const bucket of values) {
    const current = localWindows.get(bucket.key);
    const value = current && current.expiresAt > now ? current : { count: 0, expiresAt: now + bucket.windowMs };
    value.count += 1;
    localWindows.set(bucket.key, value);
    if (value.count > bucket.limit) retryAfterMs = Math.max(retryAfterMs, value.expiresAt - now);
  }
  if (retryAfterMs) throw limited(retryAfterMs);
}

async function consumeRedis(values: Bucket[]) {
  const endpoint = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!endpoint || !token) throw unavailable();
  const command = ["EVAL", REDIS_SCRIPT, String(values.length), ...values.map(({ key }) => key), ...values.flatMap(({ windowMs, limit }) => [String(windowMs), String(limit)])];
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    throw unavailable();
  }
  if (!response.ok) throw unavailable();
  const payload = await response.json().catch(() => null) as { result?: unknown } | null;
  if (!payload || !Array.isArray(payload.result) || payload.result.length !== values.length * 2) throw unavailable();
  const counts = payload.result.slice(0, values.length).map(Number);
  const ttls = payload.result.slice(values.length).map(Number);
  // PTTL=-1/-2 means a missing or non-expiring key. Neither is a valid result
  // for a bucket this request just incremented, so accepting it would turn a
  // limiter outage into an unbounded paid-provider path.
  if (counts.some((count) => !Number.isInteger(count) || count < 1)
    || ttls.some((ttl, index) => !Number.isInteger(ttl) || ttl <= 0 || ttl > values[index]!.windowMs)) throw unavailable();
  let retryAfterMs = 0;
  values.forEach((bucket, index) => {
    if ((counts[index] ?? 0) > bucket.limit) retryAfterMs = Math.max(retryAfterMs, ttls[index] ?? bucket.windowMs);
  });
  if (retryAfterMs) throw limited(retryAfterMs);
}

export async function enforceRateLimit(request: Request, policy: RateLimitPolicy, scope?: Scope) {
  const values = buckets(request, policy, scope);
  if (localMode()) return consumeLocal(values);
  return consumeRedis(values);
}

/** @deprecated Route handlers must use enforceRateLimit so distributed limits can be awaited. */
export function rateLimit(key: string, limit: number, windowMs = FIFTEEN_MINUTES): boolean {
  if (!localMode()) return false;
  try {
    consumeLocal([{ key: `legacy:${key}`, limit, windowMs }]);
    return true;
  } catch (error) {
    if (error instanceof RateLimitError && error.status === 429) return false;
    throw error;
  }
}

/** @deprecated Route handlers must pass Request to enforceRateLimit. */
export function clientKey(request: Request): string {
  if (!localMode()) throw unavailable();
  return digest(actorAddress(request));
}
