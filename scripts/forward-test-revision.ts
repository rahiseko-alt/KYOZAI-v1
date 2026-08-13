import { mockPackage } from "../apps/web/lib/kyozai/mock";
import { revisePackage } from "../apps/web/lib/kyozai/openai";
import { packageHash, RevisionError, type RevisionTarget } from "../apps/web/lib/kyozai/revision";
import type { TeachingPackage } from "../apps/web/lib/kyozai/types";

type ForwardCase = { id: string; request: string; slide: number; expected: string };

const cases: ForwardCase[] = [
  { id: "F01", slide: 1, request: "1枚目の見出しにある「入門」を「基礎」に置き換えてください。", expected: "情報セキュリティ基礎" },
  { id: "F02", slide: 2, request: "2枚目のテーマにある「共有」を「情報共有」に置き換えてください。", expected: "情報共有方法" },
  { id: "F03", slide: 3, request: "3枚目の要点にある「止まる」を「まず止まる」に置き換えてください。", expected: "まず止まる、確認する、相談する。" },
  { id: "F04", slide: 2, request: "2枚目の1つ目のラベルにある「守る」を「安全な」に置き換えてください。", expected: "安全な共有" },
  { id: "F05", slide: 2, request: "2枚目の2つ目の箇条書きにある「送信先」を「宛先」に置き換えてください。", expected: "宛先と添付を確認する" },
  { id: "F06", slide: 3, request: "3枚目の1つ目の箇条書きにある「開かず」を「開かないで」に置き換えてください。", expected: "リンクを開かないで止まる" },
  { id: "F07", slide: 4, request: "4枚目の見出しにある「承認され」を「会社が承認し」に置き換えてください。", expected: "判断の基準は会社が承認しているかどうか" },
  { id: "F08", slide: 5, request: "5枚目の要点にある「初動の速さ」を「早い報告」に置き換えてください。", expected: "早い報告が影響を小さくする" },
  { id: "F09", slide: 6, request: "6枚目の4つ目の箇条書きにある「端末」を「利用端末」に置き換えてください。", expected: "現在の利用端末状態" },
  { id: "F10", slide: 7, request: "7枚目の見出しにある「すぐ」を「速やかに」に置き換えてください。", expected: "迷ったら、操作を止めて速やかに報告する" },
  { id: "F11", slide: 1, request: "1枚目のテーマ全体を「情報を扱う基本」に言い換えてください。", expected: "情報を扱う基本" },
  { id: "F12", slide: 2, request: "2枚目の見出し全体を「共有先と方法を確認する」に言い換えてください。", expected: "共有先と方法を確認する" },
  { id: "F13", slide: 3, request: "3枚目の要点全体を「不審な連絡は止めて確認し、相談します。」に言い換えてください。", expected: "不審な連絡は止めて確認し、相談します。" },
  { id: "F14", slide: 2, request: "2枚目の2つ目のラベル全体を「避ける共有方法」に言い換えてください。", expected: "避ける共有方法" },
  { id: "F15", slide: 3, request: "3枚目の3つ目の箇条書き全体を「指定窓口に相談する」に言い換えてください。", expected: "指定窓口に相談する" },
  { id: "F16", slide: 4, request: "4枚目の見出し全体を「承認済みの方法かを確認する」に言い換えてください。", expected: "承認済みの方法かを確認する" },
  { id: "F17", slide: 5, request: "5枚目の要点全体を「早い報告で影響を小さくします。」に言い換えてください。", expected: "早い報告で影響を小さくします。" },
  { id: "F18", slide: 6, request: "6枚目の1つ目の箇条書き全体を「発生した出来事」に言い換えてください。", expected: "発生した出来事" },
  { id: "F19", slide: 6, request: "6枚目のテーマ全体を「報告に必要な確認事項」に言い換えてください。", expected: "報告に必要な確認事項" },
  { id: "F20", slide: 7, request: "7枚目の見出し全体を「迷ったら止めて報告する」に言い換えてください。", expected: "迷ったら止めて報告する" },
];

const expectedTargets: RevisionTarget[] = [
  { kind: "scalar", slideNumber: 1, field: "title" },
  { kind: "scalar", slideNumber: 2, field: "theme" },
  { kind: "scalar", slideNumber: 3, field: "keyMessage" },
  { kind: "array-item", slideNumber: 2, field: "labels", itemIndex: 0 },
  { kind: "array-item", slideNumber: 2, field: "bullets", itemIndex: 1 },
  { kind: "array-item", slideNumber: 3, field: "bullets", itemIndex: 0 },
  { kind: "scalar", slideNumber: 4, field: "title" },
  { kind: "scalar", slideNumber: 5, field: "keyMessage" },
  { kind: "array-item", slideNumber: 6, field: "bullets", itemIndex: 3 },
  { kind: "scalar", slideNumber: 7, field: "title" },
  { kind: "scalar", slideNumber: 1, field: "theme" },
  { kind: "scalar", slideNumber: 2, field: "title" },
  { kind: "scalar", slideNumber: 3, field: "keyMessage" },
  { kind: "array-item", slideNumber: 2, field: "labels", itemIndex: 1 },
  { kind: "array-item", slideNumber: 3, field: "bullets", itemIndex: 2 },
  { kind: "scalar", slideNumber: 4, field: "title" },
  { kind: "scalar", slideNumber: 5, field: "keyMessage" },
  { kind: "array-item", slideNumber: 6, field: "bullets", itemIndex: 0 },
  { kind: "scalar", slideNumber: 6, field: "theme" },
  { kind: "scalar", slideNumber: 7, field: "title" },
];

function targetValue(packageValue: TeachingPackage, target: RevisionTarget) {
  const slide = packageValue.slides[target.slideNumber - 1]!;
  return target.kind === "scalar" ? slide[target.field] : slide[target.field][target.itemIndex];
}

async function runCase(entry: ForwardCase) {
  const base = structuredClone(mockPackage);
  const before = structuredClone(base);
  try {
    const result = await revisePackage(base, entry.request, { deadlineMs: Date.now() + 180_000 });
    const expectedTarget = expectedTargets[Number(entry.id.slice(1)) - 1]!;
    const targetsInScope = expectedTarget.slideNumber === entry.slide && result.revision.changedTargets.length === 1
      && JSON.stringify(result.revision.changedTargets[0]) === JSON.stringify(expectedTarget);
    const safety = JSON.stringify(base) === JSON.stringify(before)
      && result.revision.baseHash === packageHash(base)
      && result.revision.candidateHash === packageHash(result.package)
      && targetsInScope;
    const semantic = safety && result.revision.changedTargets.some((target) => targetValue(result.package, target) === entry.expected);
    return { id: entry.id, safety, semantic, providerUnavailable: false };
  } catch (error) {
    return {
      id: entry.id,
      safety: false,
      semantic: false,
      providerUnavailable: error instanceof RevisionError && error.failureCode === "provider_unavailable",
    };
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for the opt-in forward test");
  process.env.OPENAI_MODEL = "gpt-5.5";
  const results: Array<{ id: string; safety: boolean; semantic: boolean; providerUnavailable: boolean }> = [];
  for (let offset = 0; offset < cases.length; offset += 2) {
    const batch = await Promise.all(cases.slice(offset, offset + 2).map(runCase));
    results.push(...batch);
    if (batch.every((result) => result.providerUnavailable)) break;
    if (offset + 2 < cases.length) await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const safetyCount = results.filter((result) => result.safety).length;
  const semanticCount = results.filter((result) => result.semantic).length;
  const failed = results.filter((result) => !result.safety || !result.semantic).map((result) => result.id);
  console.log(JSON.stringify({ model: "gpt-5.5", attempted: results.length, safety: safetyCount, semantic: semanticCount, failed }));
  if (results.length !== 20 || safetyCount !== 20 || semanticCount < 19) process.exitCode = 1;
}

void main();
