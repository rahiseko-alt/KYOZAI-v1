import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { isPublicProduction } from "./generation-access";
import { routeUnavailable, unauthorized } from "./http-errors";
import { readSupabasePublicConfig } from "../supabase/config";

export type AuthenticatedJobUser = {
  id: string;
  email?: string;
};

type Env = Record<string, string | undefined>;

type CloudflareAccessConfig = {
  issuer: string;
  audience: string;
};

const accessJwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Access is opt-in until the Preview Access application has been configured. */
export function cloudflareAccessEnabled(env: Env = process.env): boolean {
  return env.KYOZAI_CLOUDFLARE_ACCESS_ENABLED === "1";
}

function unavailableAccess(): never {
  // Deliberately share the nonexistence response with an unowned job. The caller
  // must not be able to distinguish an Access bypass from another user's job.
  throw routeUnavailable();
}

function readCloudflareAccessConfig(env: Env): CloudflareAccessConfig {
  const rawIssuer = env.KYOZAI_CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.KYOZAI_CLOUDFLARE_ACCESS_AUDIENCE?.trim();
  if (!rawIssuer || !audience || audience.length > 512 || /\s/.test(audience)) unavailableAccess();

  let url: URL;
  try { url = new URL(rawIssuer); } catch { unavailableAccess(); }
  if (
    url.protocol !== "https:"
    || !url.hostname.endsWith(".cloudflareaccess.com")
    || url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) unavailableAccess();
  return { issuer: url.origin, audience };
}

function accessJwks(config: CloudflareAccessConfig) {
  const existing = accessJwksByIssuer.get(config.issuer);
  if (existing) return existing;
  const keySet = createRemoteJWKSet(new URL(`${config.issuer}/cdn-cgi/access/certs`));
  accessJwksByIssuer.set(config.issuer, keySet);
  return keySet;
}

function accessUser(payload: JWTPayload): AuthenticatedJobUser {
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!subject || subject.length > 512 || !email || email.length > 320) unavailableAccess();
  // Namespace Access identities so a JWT subject can never be confused with a
  // legacy Supabase owner id while the two stores coexist during G1.
  return { id: `cf-access:${subject}`, email };
}

/**
 * Validates the Access assertion sent by Cloudflare before it reaches Vercel.
 * Cloudflare documents the issuer as the team domain and serves rotated signing
 * keys from `${teamDomain}/cdn-cgi/access/certs`.
 */
async function requireCloudflareAccessUser(request: Request, env: Env): Promise<AuthenticatedJobUser> {
  const token = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (!token) unavailableAccess();
  const config = readCloudflareAccessConfig(env);
  try {
    const { payload } = await jwtVerify(token, accessJwks(config), {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: config.audience,
    });
    if (typeof payload.exp !== "number") unavailableAccess();
    return accessUser(payload);
  } catch {
    unavailableAccess();
  }
}

/**
 * Job endpoints accept Supabase access tokens only. The browser obtains this token
 * from Supabase Auth and sends it in Authorization; service-role credentials never
 * leave the server. Production remains intentionally unavailable.
 */
export async function requireJobUser(request: Request, env: Env = process.env): Promise<AuthenticatedJobUser> {
  if (isPublicProduction(env)) throw routeUnavailable();
  if (cloudflareAccessEnabled(env)) return requireCloudflareAccessUser(request, env);
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw unauthorized();

  const config = readSupabasePublicConfig(env);
  const client = createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
  });
  const { data, error } = await client.auth.getUser(match[1]);
  if (error || !data.user) throw unauthorized();
  if (!data.user.email_confirmed_at) throw unauthorized("確認済みメールアドレスでログインしてください。");
  return { id: data.user.id, email: data.user.email ?? undefined };
}

export function requireAsyncJobsEnabled(env: Record<string, string | undefined> = process.env): void {
  if (isPublicProduction(env)) throw routeUnavailable();
  if (env.KYOZAI_ASYNC_JOBS_ENABLED !== "1") throw routeUnavailable();
}
