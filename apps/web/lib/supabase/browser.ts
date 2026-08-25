"use client";

import { createClient } from "@supabase/supabase-js";

import { readSupabasePublicConfig } from "./config";

/** Creates an authenticated browser client. Service-role credentials are never accepted here. */
export function createBrowserSupabaseClient(env: Record<string, string | undefined> = process.env) {
  const config = readSupabasePublicConfig(env);
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
