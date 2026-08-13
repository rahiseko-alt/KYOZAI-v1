import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PROCESS_STAGES,
  calculateNarrationTiming,
  canTransitionStageStatus,
  isProcessParityPipelineEnabled,
  validateProcessDeck,
  type ProcessDeck,
} from "../lib/kyozai/process-contract";

const rootFile = (path: string) => new URL(`../../../${path}`, import.meta.url);

function processDeck(): ProcessDeck {
  const slides = [
    { number: 1, title: "研修の目的", layoutFamily: "cover" as const, labels: [], speakerNotes: "最初に研修の目的を確認します。", scriptCharacters: 16, durationSeconds: 3 },
    { number: 2, title: "判断基準を揃える", layoutFamily: "compare" as const, labels: ["避ける", "行う"], speakerNotes: "二つの対応を比較して判断基準を揃えます。", scriptCharacters: 21, durationSeconds: 4 },
    { number: 3, title: "今日から実行する", layoutFamily: "action" as const, labels: [], speakerNotes: "最後に今日から行う一つの行動を決めます。", scriptCharacters: 21, durationSeconds: 4 },
  ];
  const totalScriptCharacters = slides.reduce((sum, slide) => sum + [...slide.speakerNotes].length, 0);
  return {
    processContract: "kyozai-slide-process@1.0.0",
    designProfile: "kyozai-standard@1.0.0",
    slides: slides.map((slide) => ({
      ...slide,
      ...calculateNarrationTiming(slide.speakerNotes),
    })),
    totalScriptCharacters,
    totalDurationSeconds: Math.round((totalScriptCharacters / 300) * 60),
  };
}

describe("Skill同等工程の契約", () => {
  it("機械可読な正本とAPPのstage順が一致する", () => {
    const contract = JSON.parse(readFileSync(rootFile("shared/kyozai-process-contract.json"), "utf8")) as {
      stages: Array<{ id: string }>;
      imageModelPolicy: { selectionRequiredPerJob: boolean; default?: string; allowed: string[] };
    };
    expect(contract.stages.map((stage) => stage.id)).toEqual(PROCESS_STAGES);
    expect(contract.imageModelPolicy.selectionRequiredPerJob).toBe(true);
    expect(contract.imageModelPolicy.default).toBeUndefined();
    expect(contract.imageModelPolicy.allowed).toEqual([
      "gemini-3.1-flash-lite-image",
      "gemini-3.1-flash-image",
      "gpt-image-2-medium",
    ]);
  });

  it("講師台本から300文字/分で時間を計算する", () => {
    const notes = "あ".repeat(205);
    expect(calculateNarrationTiming(notes)).toEqual({ scriptCharacters: 205, durationSeconds: 41 });
  });

  it("完了済みstageの巻き戻しと失敗後の続行を拒否する", () => {
    expect(canTransitionStageStatus("pending", "running")).toBe(true);
    expect(canTransitionStageStatus("running", "passed")).toBe(true);
    expect(canTransitionStageStatus("failed", "running")).toBe(false);
    expect(canTransitionStageStatus("passed", "failed")).toBe(false);
  });

  it("表紙・CTA・labels・時間計算を満たすdeckを受け入れる", () => {
    expect(validateProcessDeck(processDeck())).toEqual([]);
  });

  it("compare以外のlabelsとAI申告時間を拒否する", () => {
    const deck = processDeck();
    deck.slides[2]!.labels = ["不要なラベル"];
    deck.slides[1]!.durationSeconds += 1;
    expect(validateProcessDeck(deck)).toEqual(expect.arrayContaining([
      "slide 2: 時間計算が一致しません",
      "slide 3: compare以外のlabelsは空である必要があります",
    ]));
  });

  it("新pipelineは明示的に有効化するまで停止している", () => {
    expect(isProcessParityPipelineEnabled({})).toBe(false);
    expect(isProcessParityPipelineEnabled({ PROCESS_PARITY_PIPELINE_ENABLED: "1" })).toBe(true);
  });

  it("現在のSkill bundleが承認済みbaselineから変わっていない", () => {
    const baseline = JSON.parse(readFileSync(rootFile("shared/kyozai-skill-baseline.json"), "utf8")) as { files: Record<string, string> };
    for (const [path, expectedHash] of Object.entries(baseline.files)) {
      const normalized = readFileSync(rootFile(path), "utf8").replace(/\r\n/g, "\n");
      expect(createHash("sha256").update(normalized).digest("hex"), path).toBe(expectedHash);
    }
  });
});
