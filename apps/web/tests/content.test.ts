import { describe, expect, it } from "vitest";

import { HOME_HEADING, buildHomeSubheading } from "../lib/content";

describe("buildHomeSubheading", () => {
  it("見出しと年を組み合わせて返す", () => {
    const result = buildHomeSubheading(new Date("2026-08-11T00:00:00Z"));
    expect(result).toBe(`${HOME_HEADING} — 2026`);
  });
});
