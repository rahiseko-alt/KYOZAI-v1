export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export type SupabaseServerConfig = SupabasePublicConfig & {
  serviceRoleKey: string;
};

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} が設定されていません。`);
  return value;
}

export function readSupabasePublicConfig(env: Record<string, string | undefined> = process.env): SupabasePublicConfig {
  return {
    url: required(env, "NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: required(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function readSupabaseServerConfig(env: Record<string, string | undefined> = process.env): SupabaseServerConfig {
  return {
    ...readSupabasePublicConfig(env),
    serviceRoleKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}
