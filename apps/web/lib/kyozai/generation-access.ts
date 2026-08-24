export function isPublicProduction(env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV === "production";
}

export function generationIsAvailable(env: Record<string, string | undefined> = process.env) {
  if (isPublicProduction(env)) return false;
  return env.PROCESS_PARITY_PIPELINE_ENABLED === "1";
}

