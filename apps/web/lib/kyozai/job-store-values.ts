export function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    try { return stringArray(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parsedObject(value: unknown) {
  if (typeof value === "string") {
    try { return parsedObject(JSON.parse(value)); } catch { return undefined; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
