import { createClient } from "@supabase/supabase-js";

import { isPublicProduction } from "./generation-access";
import { routeUnavailable, unauthorized } from "./http-errors";
import { readSupabasePublicConfig } from "../supabase/config";

export type AuthenticatedJobUser = {
  id: string;
  email?: string;
};

/**
 * Job endpoints accept Supabase access tokens only. The browser obtains this token
 * from Supabase Auth and sends it in Authorization; service-role credentials never
 * leave the server. Production remains intentionally unavailable.
 */
export async function requireJobUser(request: Request): Promise<AuthenticatedJobUser> {
  if (isPublicProduction()) throw routeUnavailable();
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw unauthorized();

  const config = readSupabasePublicConfig();
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
