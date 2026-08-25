import { createClient } from "@supabase/supabase-js";

import { readSupabaseServerConfig } from "./config";

/**
 * Server/worker-only client. Route handlers must first establish the requesting user
 * from their bearer token or cookie; this client is reserved for controlled operations
 * such as signed uploads and workflow persistence.
 */
export function createServerSupabaseClient(env: Record<string, string | undefined> = process.env) {
  const config = readSupabaseServerConfig(env);
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
