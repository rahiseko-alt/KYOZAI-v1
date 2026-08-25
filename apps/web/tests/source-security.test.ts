import { describe, expect, it, vi } from "vitest";

import { PublicHttpError } from "../lib/kyozai/http-errors";
import { isPublicAddress, readUrl, SOURCE_FETCH_HEADERS, sourcesFromFormData } from "../lib/kyozai/source";

const PUBLIC_V4 = { address: "93.184.216.34", family: 4 as const };
const PUBLIC_V6 = { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const };
const htmlResponse = (body: BodyInit | null, init: ResponseInit = {}) => new Response(body, {
  status: 200,
  headers: { "content-type": "text/html", ...init.headers },
  ...init,
});
const deadline = () => Date.now() + 60_000;

describe("URL取得のSSRF境界", () => {
  it.each([
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.31.255.255", "192.168.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1",
    "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1",
    "64:ff9b:1::1", "100::1", "2001:db8::1", "fc00::1", "fe80::1", "ff02::1",
  ])("非公開アドレス %s を拒否する", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([PUBLIC_V4.address, PUBLIC_V6.address])("公開アドレス %s を受け入れる", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "http://127.0.0.1/secret",
    "http://[::ffff:127.0.0.1]/secret",
    "https://user:password@example.com/",
    "file:///etc/passwd",
    "https://localhost/",
    "https://service.local/",
  ])("ドメイン名の公開HTTP/HTTPS URL以外を名前解決前に拒否する: %s", async (raw) => {
    const resolve = vi.fn().mockResolvedValue([PUBLIC_V4]);
    const request = vi.fn();

    await expect(readUrl(raw, deadline(), { resolve, request })).rejects.toBeInstanceOf(PublicHttpError);
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("公開IPとprivate IPが混在するDNS応答を全体として拒否する", async () => {
    const request = vi.fn();
    await expect(readUrl("https://example.com/", deadline(), {
      resolve: vi.fn().mockResolvedValue([PUBLIC_V4, { address: "10.0.0.1", family: 4 }]),
      request,
    })).rejects.toThrow("安全のため");
    expect(request).not.toHaveBeenCalled();
  });

  it("DNS検証後の接続に検証済みIPを渡し、再解決の余地を残さない", async () => {
    const resolve = vi.fn().mockResolvedValue([PUBLIC_V4, PUBLIC_V6]);
    const request = vi.fn(async (url: URL, selected: { address: string; family: 4 | 6 }) => {
      expect(url.hostname).toBe("example.com");
      expect(selected).toEqual(PUBLIC_V4);
      return { response: htmlResponse("<main>教材本文</main>"), close: vi.fn().mockResolvedValue(undefined) };
    });

    await expect(readUrl("https://example.com/training", deadline(), { resolve, request })).resolves.toBe("教材本文");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("リダイレクト先を再解決し、private IPへの転送を拒否する", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce([PUBLIC_V4])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const request = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 302, headers: { location: "https://metadata.example/latest" } }),
      close: vi.fn().mockResolvedValue(undefined),
    });

    await expect(readUrl("https://example.com/", deadline(), { resolve, request })).rejects.toThrow("安全のため");
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("HTTPSからHTTPへのダウングレード転送を拒否する", async () => {
    const request = vi.fn().mockResolvedValue({
      response: new Response(null, { status: 302, headers: { location: "http://example.com/insecure" } }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    await expect(readUrl("https://example.com/", deadline(), {
      resolve: vi.fn().mockResolvedValue([PUBLIC_V4]), request,
    })).rejects.toThrow("安全でないURLへの転送");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("3回を超えるリダイレクトを拒否する", async () => {
    const request = vi.fn().mockImplementation(async (url: URL) => ({
      response: new Response(null, { status: 302, headers: { location: `https://example.com${url.pathname}x` } }),
      close: vi.fn().mockResolvedValue(undefined),
    }));
    await expect(readUrl("https://example.com/a", deadline(), {
      resolve: vi.fn().mockResolvedValue([PUBLIC_V4]), request,
    })).rejects.toThrow("転送先を確認できません");
    expect(request).toHaveBeenCalledTimes(4);
  });
});

describe("URL本文の実受信量制限", () => {
  it("自動展開による上限回避を抑えるため圧縮なしを要求する", () => {
    expect(SOURCE_FETCH_HEADERS).toMatchObject({ "Accept-Encoding": "identity" });
  });

  it("chunked応答が1.5MBを超えた時点でcancelし、413用エラーにする", async () => {
    let cancelled = false;
    const chunks = [new Uint8Array(1_000_000), new Uint8Array(500_001), new Uint8Array(10)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() { cancelled = true; },
    });
    const response = htmlResponse(body, { headers: { "content-type": "text/html", "content-length": "1" } });
    const error = await readUrl("https://example.com/", deadline(), {
      resolve: vi.fn().mockResolvedValue([PUBLIC_V4]),
      request: vi.fn().mockResolvedValue({ response, close: vi.fn().mockResolvedValue(undefined) }),
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });

  it("本文ストリームが途中で壊れても、接続を閉じて本文を成果物に渡さない", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("途中までの本文"));
        controller.error(new Error("upstream stream failed"));
      },
    });
    const response = htmlResponse(body);

    await expect(readUrl("https://example.com/", deadline(), {
      resolve: vi.fn().mockResolvedValue([PUBLIC_V4]),
      request: vi.fn().mockResolvedValue({ response, close }),
    })).rejects.toThrow("upstream stream failed");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("自己申告content-lengthが上限超過なら本文を読まずに拒否する", async () => {
    const response = htmlResponse("小さい本文", { headers: { "content-type": "text/html", "content-length": "1500001" } });
    await expect(readUrl("https://example.com/", deadline(), {
      resolve: vi.fn().mockResolvedValue([PUBLIC_V4]),
      request: vi.fn().mockResolvedValue({ response, close: vi.fn().mockResolvedValue(undefined) }),
    })).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("2MBを超える単一ファイルをmultipart解析後の二次防御で拒否する", async () => {
    const form = new FormData();
    form.append("files", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" }));
    await expect(sourcesFromFormData(form)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });
});
