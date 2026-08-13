import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { SourceInput } from "./types";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 80_000;
const TEXT_TYPES = new Set(["text/plain", "text/markdown"]);
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];

function remainingTimeout(deadlineMs: number, maximumMs = 10_000) {
  const timeoutMs = Math.min(maximumMs, deadlineMs - Date.now() - 5_000);
  if (timeoutMs < 1_000) throw new Error("URLの読み込み時間が上限に達しました。URLはそのままで、もう一度お試しください。");
  return timeoutMs;
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("URLの名前解決が時間内に完了しませんでした。")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

async function validatePublicUrl(url: URL, deadlineMs: number) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("公開されたHTTP/HTTPS URLを指定してください。");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("ローカルURLは読み込めません。");
  const addresses = await withinTimeout(lookup(url.hostname, { all: true }), remainingTimeout(deadlineMs));
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("このURLは安全のため読み込めません。");
}

async function readUrl(raw: string, deadlineMs: number): Promise<string> {
  let url = new URL(raw);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await validatePublicUrl(url, deadlineMs);
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(remainingTimeout(deadlineMs)), headers: { "User-Agent": "KYOZAI-Preview/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("URLの転送先を確認できませんでした。");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error("URLを読み込めませんでした。");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 1_500_000) throw new Error("URLの内容が大きすぎます。");
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
    if (!["text/html", "text/plain", "application/xhtml+xml"].includes(contentType)) throw new Error("体験版のURL入力はWebページとテキストだけに対応しています。");
    const html = (await response.text()).slice(0, 1_500_000);
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .slice(0, MAX_TEXT_CHARS);
  }
  throw new Error("URLを読み込めませんでした。");
}

export async function sourcesFromFormData(form: FormData, deadlineMs = Number.POSITIVE_INFINITY): Promise<SourceInput[]> {
  const sources: SourceInput[] = [];
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 2) throw new Error("一度に追加できるファイルは2件までです。");

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} は8MB以下にしてください。`);
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isText = TEXT_TYPES.has(file.type) || TEXT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
    if (!isPdf && !isText) throw new Error(`${file.name} は現在対応していない形式です。`);
    if (isPdf) {
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`${file.name} は有効なPDFではありません。`);
      const base64 = bytes.toString("base64");
      sources.push({ type: "input_file", filename: file.name, file_data: `data:application/pdf;base64,${base64}` });
    } else {
      const text = await file.text();
      if (text.includes("\0")) throw new Error(`${file.name} はテキストファイルとして読み込めません。`);
      sources.push({ type: "input_text", text: `ファイル: ${file.name}\n${text.slice(0, MAX_TEXT_CHARS)}` });
    }
  }

  const directText = String(form.get("sourceText") || "").trim();
  if (directText) sources.push({ type: "input_text", text: `入力テキスト:\n${directText.slice(0, MAX_TEXT_CHARS)}` });
  const sourceUrl = String(form.get("sourceUrl") || "").trim();
  if (sourceUrl) sources.push({ type: "input_text", text: `参照URL: ${sourceUrl}\n${await readUrl(sourceUrl, deadlineMs)}` });
  if (!sources.length) throw new Error("資料、URL、またはテキストを1つ以上追加してください。");
  return sources;
}
