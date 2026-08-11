import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildStaticSecurityHeaders,
  createNonce,
} from "../lib/security/headers";

describe("createNonce", () => {
  it("呼ぶたびに異なる値を返す", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe("buildContentSecurityPolicy", () => {
  it("script-src に渡した nonce を含む", () => {
    const nonce = "test-nonce";
    const csp = buildContentSecurityPolicy(nonce);
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("object-src 'none'");
  });
});

describe("buildStaticSecurityHeaders", () => {
  it("HSTS を含む固定ヘッダを返す", () => {
    const headers = buildStaticSecurityHeaders();
    const hsts = headers.find((h) => h.key === "Strict-Transport-Security");
    expect(hsts?.value).toContain("max-age=63072000");
  });
});
