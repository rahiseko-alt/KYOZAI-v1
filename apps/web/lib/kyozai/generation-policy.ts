import type { RateLimitPolicy } from "./rate-limit";

/** The single rate-limit policy for authenticated durable job entrypoints. */
export const DURABLE_JOB_RATE_LIMIT_POLICY: RateLimitPolicy = "generate";
