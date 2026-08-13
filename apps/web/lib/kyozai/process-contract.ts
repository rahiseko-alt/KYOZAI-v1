import type { LayoutFamily } from "./types";

export const PROCESS_CONTRACT_ID = "kyozai-slide-process@1.0.0";
export const PROCESS_STAGES = [
  "source_ingest",
  "analysis",
  "slide_map",
  "script_timing",
  "content_freeze",
  "design",
  "image_generate",
  "image_validate",
  "package",
  "revision",
] as const;

export type ProcessStage = (typeof PROCESS_STAGES)[number];
export type StageStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export type ProcessSlide = {
  number: number;
  title: string;
  layoutFamily: LayoutFamily;
  labels: string[];
  speakerNotes: string;
  scriptCharacters: number;
  durationSeconds: number;
};

export type ProcessDeck = {
  processContract: string;
  designProfile: string;
  slides: ProcessSlide[];
  totalScriptCharacters: number;
  totalDurationSeconds: number;
};

const TERMINAL_STATUSES = new Set<StageStatus>(["passed", "failed", "skipped"]);

export function calculateNarrationTiming(speakerNotes: string) {
  const scriptCharacters = [...speakerNotes].length;
  return {
    scriptCharacters,
    durationSeconds: Math.round((scriptCharacters / 300) * 60),
  };
}

export function canTransitionStageStatus(from: StageStatus, to: StageStatus) {
  if (from === to) return true;
  if (TERMINAL_STATUSES.has(from)) return false;
  if (from === "pending") return to === "running" || to === "skipped";
  return to === "passed" || to === "failed";
}

export function validateProcessDeck(deck: ProcessDeck) {
  const errors: string[] = [];
  if (deck.processContract !== PROCESS_CONTRACT_ID) errors.push("processContractが正本と一致しません");
  if (deck.designProfile !== "kyozai-standard@1.0.0") errors.push("designProfileが正本と一致しません");
  if (deck.slides.length < 3 || deck.slides.length > 12) errors.push("スライド枚数は3〜12枚である必要があります");
  if (deck.slides[0]?.layoutFamily !== "cover") errors.push("先頭はcoverである必要があります");
  if (deck.slides.at(-1)?.layoutFamily !== "action") errors.push("末尾はactionである必要があります");

  let scriptCharacters = 0;
  deck.slides.forEach((slide, index) => {
    if (slide.number !== index + 1) errors.push(`slide ${index + 1}: numberが連番ではありません`);
    const timing = calculateNarrationTiming(slide.speakerNotes);
    scriptCharacters += timing.scriptCharacters;
    if (slide.scriptCharacters !== timing.scriptCharacters) errors.push(`slide ${slide.number}: 文字数が一致しません`);
    if (slide.durationSeconds !== timing.durationSeconds) errors.push(`slide ${slide.number}: 時間計算が一致しません`);
    if (slide.layoutFamily === "compare" && slide.labels.length !== 2) errors.push(`slide ${slide.number}: compareには2つのlabelsが必要です`);
    if (slide.layoutFamily !== "compare" && slide.labels.length !== 0) errors.push(`slide ${slide.number}: compare以外のlabelsは空である必要があります`);
    if (index >= 2 && slide.layoutFamily === deck.slides[index - 1]?.layoutFamily && slide.layoutFamily === deck.slides[index - 2]?.layoutFamily) {
      errors.push(`slide ${slide.number}: 同じlayoutFamilyを3枚連続で使用できません`);
    }
  });

  const durationSeconds = Math.round((scriptCharacters / 300) * 60);
  if (deck.totalScriptCharacters !== scriptCharacters) errors.push("合計文字数が一致しません");
  if (deck.totalDurationSeconds !== durationSeconds) errors.push("合計時間が一致しません");
  return errors;
}

export function isProcessParityPipelineEnabled(env: Record<string, string | undefined> = process.env) {
  return env.PROCESS_PARITY_PIPELINE_ENABLED === "1";
}
