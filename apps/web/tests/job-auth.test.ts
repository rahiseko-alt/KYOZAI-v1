import { exportJWK, generateKeyPair, SignJWT, type GenerateKeyPairResult, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { cloudflareAccessEnabled, requireJobUser } from "../lib/kyozai/job-auth";

const issuer = "https://preview-team.cloudflareaccess.com";
const audience = "preview-job-api-audience";
const accessEnv = {
  KYOZAI_CLOUDFLARE_ACCESS_ENABLED: "1",
  KYOZAI_CLOUDFLARE_ACCESS_TEAM_DOMAIN: issuer,
  KYOZAI_CLOUDFLARE_ACCESS_AUDIENCE: audience,
};

let privateKey: GenerateKeyPairResult["privateKey"];
let publicJwk: JWK;
let originalFetch: typeof fetch;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  publicJwk = { ...await exportJWK(keys.publicKey), kid: "test-access-key", alg: "RS256", use: "sig" };
  originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    expect(url).toBe(`${issuer}/cdn-cgi/access/certs`);
    return Response.json({ keys: [publicJwk] });
  }));
});

afterAll(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.unstubAllGlobals();
});

async function accessToken(overrides: { issuer?: string; audience?: string; expiresAt?: string; email?: string; subject?: string } = {}) {
  return new SignJWT({ email: overrides.email ?? "preview-user@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "test-access-key" })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setSubject(overrides.subject ?? "access-subject-123")
    .setExpirationTime(overrides.expiresAt ?? "5m")
    .sign(privateKey);
}

function request(token?: string) {
  return new Request("https://preview.example.test/api/jobs", token ? { headers: { "cf-access-jwt-assertion": token } } : undefined);
}

describe("Cloudflare Access job authentication", () => {
  it("Access is opt-in while the legacy gateway remains in service", () => {
    expect(cloudflareAccessEnabled({})).toBe(false);
    expect(cloudflareAccessEnabled(accessEnv)).toBe(true);
  });

  it("accepts a Cloudflare assertion signed by the configured JWKS", async () => {
    await expect(requireJobUser(request(await accessToken()), accessEnv)).resolves.toEqual({
      id: "cf-access:access-subject-123",
      email: "preview-user@example.test",
    });
  });

  it.each([
    ["missing Access assertion", undefined],
    ["wrong issuer", () => accessToken({ issuer: "https://other.cloudflareaccess.com" })],
    ["wrong audience", () => accessToken({ audience: "other-audience" })],
    ["expired assertion", () => accessToken({ expiresAt: "-1s" })],
    ["missing email identity", () => accessToken({ email: "" })],
  ])("returns the nonexistence response for %s", async (_case, makeToken) => {
    const token = makeToken ? await makeToken() : undefined;
    await expect(requireJobUser(request(token), accessEnv)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("does not fall back to Supabase when the Access configuration is incomplete", async () => {
    await expect(requireJobUser(request(await accessToken()), {
      KYOZAI_CLOUDFLARE_ACCESS_ENABLED: "1",
      KYOZAI_CLOUDFLARE_ACCESS_TEAM_DOMAIN: issuer,
    })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
