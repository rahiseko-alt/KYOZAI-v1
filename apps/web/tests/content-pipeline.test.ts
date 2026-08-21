import { describe, expect, it } from "vitest";

import { buildTeachingPackage, type ScriptStage, type SlideMap } from "../lib/kyozai/content-pipeline";
import { PROCESS_STAGES } from "../lib/kyozai/process-contract";
import type { TeachingAnalysis } from "../lib/kyozai/types";

const sources = [{ type: "input_text" as const, text: "入力テキスト:\n会議では結論、理由、次の行動を明確にする。曖昧な依頼は期限と担当を確認する。" }];
const analysis: TeachingAnalysis = {
  targetAudience: "新任リーダー",
  problem: "会議後の行動が曖昧になる",
  outcome: "担当と期限を明示して合意できる",
  coreClaim: "結論と次の行動を明確にする",
  evidence: ["原文は結論、理由、次の行動を明確にするよう求めている"],
  examples: ["曖昧な依頼では期限と担当を確認する"],
  finalAction: "次の会議で担当と期限を確認する",
};
const map: SlideMap = {
  title: "会議を行動につなげる",
  sourceSummary: "結論と次の行動を明確にする会議の基本を扱う。",
  learningObjectives: ["会議の結論を言語化できる", "担当と期限を確認できる"],
  slides: [
    { number: 1, layoutFamily: "cover", labels: [], theme: "会議の目的", role: "introduction", title: "会議を行動につなげる", keyMessage: "結論から次の行動までを決める", bullets: ["結論を明確にする", "行動を具体化する"], composition: "中央に題名、下段に結論から行動へ進む一本の矢印" },
    { number: 2, layoutFamily: "compare", labels: ["曖昧", "明確"], theme: "合意の違い", role: "understanding", title: "担当と期限が行動を明確にする", keyMessage: "誰がいつまでに行うかを決める", bullets: ["担当者を確認する", "期限を確認する"], composition: "左に担当と期限が空欄の例、右に両方が埋まった例を同じ幅で配置" },
    { number: 3, layoutFamily: "sequence", labels: [], theme: "確認手順", role: "practice", title: "結論から二段階で確認する", keyMessage: "結論、担当と期限の順で確認する", bullets: ["結論を一文にする", "担当と期限を聞く"], composition: "左から右へ、結論、担当、期限の3要素を矢印で接続" },
    { number: 4, layoutFamily: "action", labels: [], theme: "次の会議", role: "action", title: "次の会議で担当と期限を確認する", keyMessage: "会議を終える前に一度確認する", bullets: ["担当者の名前を言う", "期限を日付で言う"], composition: "中央に一つのチェック欄、下に担当と期限の2項目を横並び" },
  ],
};
const scripts: ScriptStage = {
  slides: map.slides.map((slide) => ({ number: slide.number, speakerNotes: `${slide.title}理由と具体例を説明し、受講者が次の場面で実行できるよう確認します。` })),
  scenario: [
    { section: "導入", minutes: 1, guidance: "会議後に困った経験を確認する" },
    { section: "理解", minutes: 2, guidance: "比較と手順を説明する" },
    { section: "行動", minutes: 1, guidance: "次の会議で行うことを決める" },
  ],
  faq: [
    { question: "期限が未定なら？", answer: "決定予定日を確認します。" },
    { question: "担当が複数なら？", answer: "主担当を明確にします。" },
    { question: "結論が出ないなら？", answer: "次に決める事項を明確にします。" },
  ],
  quiz: [
    { question: "会議の最後に確認するものは？", options: ["担当と期限", "参加人数", "会議室"], answerIndex: 0, explanation: "行動を明確にするためです。" },
    { question: "期限が未定なら？", options: ["放置する", "決定予定日を聞く", "推測する"], answerIndex: 1, explanation: "次の確認時点を明確にします。" },
    { question: "主担当を決める理由は？", options: ["責任追及", "行動の明確化", "資料削減"], answerIndex: 1, explanation: "誰が進めるかを明確にします。" },
  ],
};

describe("内容先行の段階パイプライン", () => {
  it("同じ入力から分析、マップ、台本、時間、凍結証跡を持つdeckを組み立てる", () => {
    const result = buildTeachingPackage(sources, analysis, map, scripts, { passed: true, issues: [] });
    expect(result.process?.contract).toBe("kyozai-slide-process@1.0.0");
    expect(result.process?.source.refs).toEqual(["direct-input-1"]);
    expect(result.process?.source.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.process?.stageLedger.map((entry) => entry.stage)).toEqual(PROCESS_STAGES);
    expect(result.process?.stageLedger.slice(0, 6).every((entry) => entry.status === "passed")).toBe(true);
    expect(result.process?.stageLedger.slice(6).every((entry) => entry.status === "pending")).toBe(true);
    expect(result.process?.imagePrompts).toHaveLength(result.slides.length);
    expect(result.process?.imagePrompts[1]?.prompt).toContain(map.slides[1]?.composition);
    expect(result.process?.imagePrompts[1]?.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.slides.every((slide) => slide.scriptCharacters === [...slide.speakerNotes].length)).toBe(true);
    expect(result.slides.every((slide) => slide.durationSeconds === Math.round(([...slide.speakerNotes].length / 300) * 60))).toBe(true);
    expect(result.process?.totalScriptCharacters).toBe(result.slides.reduce((sum, slide) => sum + (slide.scriptCharacters ?? 0), 0));
    expect(result.slides[1]?.composition).toContain("左");
  });

  it("内容凍結QAの不合格時は画像工程へ渡すdeckを作らない", () => {
    expect(() => buildTeachingPackage(sources, analysis, map, scripts, { passed: false, issues: ["タイトル列の論理が途切れている"] }))
      .toThrow("内容凍結QAに合格しませんでした");
  });

  it("AIが見落としても機械検証で表紙とCTAの欠落を止める", () => {
    const invalid = structuredClone(map);
    invalid.slides[0]!.layoutFamily = "focus";
    expect(() => buildTeachingPackage(sources, analysis, invalid, scripts, { passed: true, issues: [] }))
      .toThrow("先頭はcoverである必要があります");
  });
});
