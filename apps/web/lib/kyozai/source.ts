import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { DomUtils, parseDocument } from "htmlparser2";
import { Agent, fetch as undiciFetch } from "undici";

import { badRequest, payloadTooLarge, PublicHttpError } from "./http-errors";
import type { SourceInput } from "./types";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;
const MAX_URL_BYTES = 1_500_000;
const TEXT_TYPES = new Set(["text/plain", "text/markdown"]);
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];
const ALLOWED_URL_TYPES = new Set(["text/html", "text/plain", "application/xhtml+xml"]);
export const SOURCE_FETCH_HEADERS = Object.freeze({ "Accept-Encoding": "identity", "User-Agent": "KYOZAI-Preview/1.0" });

type AddressRecord = { address: string; family: 4 | 6 };
type PinnedResponse = { response: Response; close: () => Promise<void> };
type SourceNetworkDependencies = {
  resolve: (hostname: string) => Promise<AddressRecord[]>;
  request: (url: URL, selected: AddressRecord, signal: AbortSignal) => Promise<PinnedResponse>;
};

const blockedV4 = new BlockList();
[
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
].forEach(([address, prefix]) => blockedV4.addSubnet(String(address), Number(prefix), "ipv4"));

const blockedV6 = new BlockList();
[
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28],
  ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
  ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
].forEach(([address, prefix]) => blockedV6.addSubnet(String(address), Number(prefix), "ipv6"));

function remainingTimeout(deadlineMs: number, maximumMs = 10_000) {
  const timeoutMs = Math.min(maximumMs, deadlineMs - Date.now() - 5_000);
  if (timeoutMs < 1_000) throw badRequest("URLの読み込み時間が上限に達しました。URLはそのままで、もう一度お試しください。");
  return timeoutMs;
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(badRequest("URLの名前解決が時間内に完了しませんでした。")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !blockedV6.check(address, "ipv6");
  return false;
}

function validateUrlShape(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw badRequest("公開されたHTTP/HTTPS URLを指定してください。");
  if (isIP(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw badRequest("ローカルURLやIPアドレスは読み込めません。");
  }
}

async function resolvePublicUrl(url: URL, deadlineMs: number, resolve: SourceNetworkDependencies["resolve"]) {
  validateUrlShape(url);
  let addresses: AddressRecord[];
  try {
    addresses = await withinTimeout(resolve(url.hostname), remainingTimeout(deadlineMs));
  } catch (error) {
    if (error instanceof PublicHttpError) throw error;
    throw badRequest("URLの接続先を確認できませんでした。");
  }
  if (!addresses.length || addresses.some(({ address, family }) => isIP(address) !== family || !isPublicAddress(address))) {
    throw badRequest("このURLは安全のため読み込めません。");
  }
  return addresses[0]!;
}

async function defaultRequest(url: URL, selected: AddressRecord, signal: AbortSignal): Promise<PinnedResponse> {
  const lookupPinned: LookupFunction = (hostname, options, callback) => {
    if (hostname.toLowerCase() !== url.hostname.toLowerCase()) {
      callback(new Error("検証していない接続先です。"), selected.address, selected.family);
      return;
    }
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: selected.address, family: selected.family }]);
      return;
    }
    callback(null, selected.address, selected.family);
  };
  const dispatcher = new Agent({ connect: { lookup: lookupPinned } });
  try {
    const response = await undiciFetch(url, {
      redirect: "manual",
      signal,
      dispatcher,
      headers: SOURCE_FETCH_HEADERS,
    });
    return { response: response as unknown as Response, close: () => dispatcher.close() };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

async function readBoundedText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_URL_BYTES) throw payloadTooLarge("URLの内容が大きすぎます。");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_URL_BYTES) {
        await reader.cancel();
        throw payloadTooLarge("URLの内容が大きすぎます。");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

const defaultNetwork: SourceNetworkDependencies = {
  resolve: async (hostname) => lookup(hostname, { all: true, verbatim: true }) as Promise<AddressRecord[]>,
  request: defaultRequest,
};

export async function readUrl(raw: string, deadlineMs: number, network: SourceNetworkDependencies = defaultNetwork): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("公開されたHTTP/HTTPS URLを指定してください。");
  }
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const selected = await resolvePublicUrl(url, deadlineMs, network.resolve);
    const { response, close } = await network.request(url, selected, AbortSignal.timeout(remainingTimeout(deadlineMs)));
    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw badRequest("URLの転送先を確認できませんでした。");
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, url);
        } catch {
          throw badRequest("URLの転送先を確認できませんでした。");
        }
        if (url.protocol === "https:" && nextUrl.protocol !== "https:") throw badRequest("安全でないURLへの転送は読み込めません。");
        await response.body?.cancel();
        url = nextUrl;
        continue;
      }
      if (!response.ok) throw badRequest("URLを読み込めませんでした。");
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
      if (!ALLOWED_URL_TYPES.has(contentType)) throw badRequest("体験版のURL入力はWebページとテキストだけに対応しています。");
      return extractVisibleText(await readBoundedText(response));
    } finally {
      await close();
    }
  }
  throw badRequest("URLを読み込めませんでした。");
}

export function extractVisibleText(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  const hiddenElements = DomUtils.findAll((element) => element.name === "script" || element.name === "style", document);
  hiddenElements.forEach((element) => DomUtils.removeElement(element));
  return DomUtils.textContent(document).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
}

export async function sourcesFromFormData(form: FormData, deadlineMs = Number.POSITIVE_INFINITY): Promise<SourceInput[]> {
  const sources: SourceInput[] = [];
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 2) throw badRequest("一度に追加できるファイルは2件までです。");

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) throw payloadTooLarge(`${file.name} は2MB以下にしてください。`);
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isText = TEXT_TYPES.has(file.type) || TEXT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
    if (!isPdf && !isText) throw badRequest(`${file.name} は現在対応していない形式です。`);
    if (isPdf) {
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw badRequest(`${file.name} は有効なPDFではありません。`);
      const base64 = bytes.toString("base64");
      sources.push({ type: "input_file", filename: file.name, file_data: `data:application/pdf;base64,${base64}` });
    } else {
      const text = await file.text();
      if (text.includes("\0")) throw badRequest(`${file.name} はテキストファイルとして読み込めません。`);
      sources.push({ type: "input_text", text: `ファイル: ${file.name}\n${text.slice(0, MAX_TEXT_CHARS)}` });
    }
  }

  const directText = String(form.get("sourceText") || "").trim();
  if (directText) sources.push({ type: "input_text", text: `入力テキスト:\n${directText.slice(0, MAX_TEXT_CHARS)}` });
  const sourceUrl = String(form.get("sourceUrl") || "").trim();
  if (sourceUrl) sources.push({ type: "input_text", text: `参照URL: ${sourceUrl}\n${await readUrl(sourceUrl, deadlineMs)}` });
  if (!sources.length) throw badRequest("資料、URL、またはテキストを1つ以上追加してください。");
  return sources;
}
