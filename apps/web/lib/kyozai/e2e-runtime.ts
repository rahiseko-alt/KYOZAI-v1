import { randomBytes } from "node:crypto";

type RuntimeEnv = Record<string, string | undefined>;

let ephemeralSecret: string | undefined;

/**
 * E2E conveniences are intentionally unavailable in Production even when a
 * deployment retains the E2E flag. The generated secret remains only in this
 * process; it is neither configured, logged, nor persisted.
 */
export function isE2eRuntimeAllowed(env: RuntimeEnv = process.env) {
  return env.KYOZAI_E2E_MODE === "1" && env.VERCEL_ENV !== "production";
}

export function e2eEphemeralSecret(env: RuntimeEnv = process.env) {
  if (!isE2eRuntimeAllowed(env)) return undefined;
  ephemeralSecret ??= randomBytes(32).toString("base64url");
  return ephemeralSecret;
}
