export function isPublicProduction(env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV === "production";
}

export function personalPwaEnabled(env: Record<string, string | undefined> = process.env) {
  return isPublicProduction(env) && env.KYOZAI_PERSONAL_PWA_ENABLED === "1";
}

export function generationIsAvailable(env: Record<string, string | undefined> = process.env) {
  if (isPublicProduction(env) && !personalPwaEnabled(env)) return false;
  return env.PROCESS_PARITY_PIPELINE_ENABLED === "1";
}

