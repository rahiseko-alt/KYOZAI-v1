const windows = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  windows.set(key, recent);
  return true;
}

export function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
