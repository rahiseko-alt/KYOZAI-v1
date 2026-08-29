import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("../lib/supabase/server", () => ({
  createServerSupabaseClient: () => harness.client,
}));

import {
  beginProviderAttempt,
  confirmProviderAttempt,
  withProviderAttemptContext,
} from "../lib/kyozai/provider-attempt";

type Reservation = {
  charge_state: "reserved" | "confirmed" | "ambiguous" | "released";
  result_storage_path: string | null;
  result_sha256: string | null;
  result_byte_size: number | null;
  should_call: boolean;
};

const context = {
  jobId: "00000000-0000-4000-8000-000000000001",
  revisionId: "00000000-0000-4000-8000-000000000002",
  stageRunId: "00000000-0000-4000-8000-000000000003",
  stage: "analysis",
  slideNumber: 0,
};
const input = {
  operation: "text_generation" as const,
  provider: "openai",
  model: "test-model",
  logicalAttempt: "analysis:1",
};

describe("provider試行の回収", () => {
  let reservation: Reservation;
  let rpc: ReturnType<typeof vi.fn>;
  let upload: ReturnType<typeof vi.fn>;
  let download: ReturnType<typeof vi.fn>;
  let checkpoints: Map<string, Buffer>;

  beforeEach(() => {
    reservation = {
      charge_state: "reserved",
      result_storage_path: null,
      result_sha256: null,
      result_byte_size: null,
      should_call: true,
    };
    checkpoints = new Map();
    rpc = vi.fn(async (name: string) => name === "reserve_kyozai_provider_attempt"
      ? { data: [reservation], error: null }
      : { data: true, error: null });
    upload = vi.fn(async (path: string, bytes: Buffer) => {
      if (checkpoints.has(path)) return { data: null, error: { message: "exists" } };
      checkpoints.set(path, Buffer.from(bytes));
      return { data: { path }, error: null };
    });
    download = vi.fn(async (path: string) => {
      const bytes = checkpoints.get(path);
      return bytes
        ? { data: new Blob([Uint8Array.from(bytes)]), error: null }
        : { data: null, error: { message: "missing" } };
    });
    harness.client = {
      rpc,
      storage: { from: () => ({ upload, download }) },
    };
  });

  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("provider成功結果を保存し、別stage runでは呼び直さず回収する", async () => {
    const first = await withProviderAttemptContext(context, () => beginProviderAttempt(input));
    expect(first).toMatchObject({ tracked: true });
    if (!first.tracked) throw new Error("provider attempt was not tracked");
    const checkpoint = Buffer.from(JSON.stringify({ payload: { status: "completed" }, raw: "{}", status: 200 }));
    await confirmProviderAttempt(first, checkpoint);

    reservation = {
      charge_state: "confirmed",
      result_storage_path: first.checkpointPath,
      result_sha256: createHash("sha256").update(checkpoint).digest("hex"),
      result_byte_size: checkpoint.length,
      should_call: false,
    };
    const recovered = await withProviderAttemptContext(
      { ...context, stageRunId: "00000000-0000-4000-8000-000000000004" },
      () => beginProviderAttempt(input),
    );

    expect(recovered).toMatchObject({ tracked: true, fingerprint: first.fingerprint, recovered: checkpoint });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.filter(([name]) => name === "reserve_kyozai_provider_attempt")).toHaveLength(2);
    expect(rpc.mock.calls.filter(([name]) => name === "settle_kyozai_provider_attempt")).toHaveLength(1);
  });

  it("保存済みcheckpointのない曖昧試行を再送可能にしない", async () => {
    reservation = {
      charge_state: "ambiguous",
      result_storage_path: null,
      result_sha256: null,
      result_byte_size: null,
      should_call: false,
    };

    await expect(withProviderAttemptContext(context, () => beginProviderAttempt(input)))
      .rejects.toThrow("provider_result_unavailable:ambiguous");
    expect(upload).not.toHaveBeenCalled();
  });

  it("予約状態でも先に保存されたcheckpointを回収して確定する", async () => {
    const initial = await withProviderAttemptContext(context, () => beginProviderAttempt(input));
    if (!initial.tracked) throw new Error("provider attempt was not tracked");
    const checkpoint = Buffer.from("provider response checkpoint");
    checkpoints.set(initial.checkpointPath, checkpoint);
    reservation = {
      charge_state: "reserved",
      result_storage_path: null,
      result_sha256: null,
      result_byte_size: null,
      should_call: false,
    };
    rpc.mockClear();

    const recovered = await withProviderAttemptContext(context, () => beginProviderAttempt(input));

    expect(recovered).toMatchObject({ tracked: true, recovered: checkpoint });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "reserve_kyozai_provider_attempt",
      "settle_kyozai_provider_attempt",
    ]);
  });

  it("checkpoint保存直後の停止からproviderを呼び直さず回収する", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("KYOZAI_G1_FAULT_INJECTION_ENABLED", "1");
    vi.stubEnv("KYOZAI_G1_FAULT_POINT", "provider_checkpoint_saved");
    const initial = await withProviderAttemptContext(context, () => beginProviderAttempt(input));
    if (!initial.tracked) throw new Error("provider attempt was not tracked");
    const checkpoint = Buffer.from("saved before database settlement");

    await expect(confirmProviderAttempt(initial, checkpoint)).rejects.toThrow("provider_checkpoint_fault_injected");
    reservation = {
      charge_state: "reserved",
      result_storage_path: null,
      result_sha256: null,
      result_byte_size: null,
      should_call: false,
    };
    vi.stubEnv("KYOZAI_G1_FAULT_INJECTION_ENABLED", "0");
    rpc.mockClear();

    const recovered = await withProviderAttemptContext(
      { ...context, stageRunId: "00000000-0000-4000-8000-000000000005" },
      () => beginProviderAttempt(input),
    );

    expect(recovered).toMatchObject({ tracked: true, fingerprint: initial.fingerprint, recovered: checkpoint });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "reserve_kyozai_provider_attempt",
      "settle_kyozai_provider_attempt",
    ]);
  });

  it("Cloudflare gatewayではprivate R2 checkpointから回収し、Supabaseを呼ばない", async () => {
    vi.stubEnv("KYOZAI_CLOUDFLARE_STATE_ENABLED", "1");
    vi.stubEnv("KYOZAI_CONTROL_PLANE_URL", "https://control.example");
    vi.stubEnv("KYOZAI_CONTROL_PLANE_TOKEN", "test-only-token");
    const checkpoint = Buffer.from("cloudflare checkpoint");
    let firstFingerprint = "";
    let settled = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const address = String(url);
      if (address.endsWith("/providers/commands")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (body.command === "reserve") {
          firstFingerprint ||= String(body.requestFingerprint);
          return Response.json(settled
            ? { charge_state: "confirmed", result_storage_path: `${context.jobId}/${context.revisionId}/provider-results/${firstFingerprint}.json`, result_sha256: createHash("sha256").update(checkpoint).digest("hex"), result_byte_size: checkpoint.length, shouldCall: false }
            : { charge_state: "reserved", result_storage_path: null, result_sha256: null, result_byte_size: null, shouldCall: true });
        }
        settled = true;
        return Response.json({ settled: true });
      }
      if (address.endsWith("/artifacts/commands")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (body.command === "read") return Response.json({ artifact: { metadata: {}, storage_path: "fixture/checkpoint.json", sha256: createHash("sha256").update(checkpoint).digest("hex") } });
        return Response.json({ artifactId: "provider-checkpoint" });
      }
      if (address.endsWith("/bytes") && init?.method === "PUT") return Response.json({ artifactId: "provider-checkpoint", byteSize: checkpoint.length });
      if (address.endsWith("/bytes")) return new Response(checkpoint, { status: 200 });
      throw new Error(`unexpected gateway route: ${address}`);
    });
    vi.stubGlobal("fetch", fetcher);

    const initial = await withProviderAttemptContext(context, () => beginProviderAttempt(input));
    if (!initial.tracked) throw new Error("provider attempt was not tracked");
    await confirmProviderAttempt(initial, checkpoint);
    const recovered = await withProviderAttemptContext({ ...context, stageRunId: "00000000-0000-4000-8000-000000000006" }, () => beginProviderAttempt(input));

    expect(recovered).toMatchObject({ tracked: true, recovered: checkpoint });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/providers/commands"))).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
