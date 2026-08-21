import { createHash } from "node:crypto";

import { DESIGN_PROFILE_ID } from "./design";
import { buildSlideImagePrompt } from "./image-prompt";
import { PROCESS_CONTRACT_ID, PROCESS_STAGES, calculateNarrationTiming, validateProcessDeck } from "./process-contract";
import type { LayoutFamily, SourceInput, StageLedgerEntry, TeachingAnalysis, TeachingPackage } from "./types";

export type SlideMap = {
  title: string;
  sourceSummary: string;
  learningObjectives: string[];
  slides: Array<{
    number: number;
    layoutFamily: LayoutFamily;
    labels: string[];
    theme: string;
    role: "introduction" | "overview" | "understanding" | "example" | "practice" | "summary" | "action";
    title: string;
    keyMessage: string;
    bullets: string[];
    composition: string;
  }>;
};

export type ScriptStage = Pick<TeachingPackage, "scenario" | "faq" | "quiz"> & {
  slides: Array<{ number: number; speakerNotes: string }>;
};

export type ContentFreezeReview = { passed: boolean; issues: string[] };

function sourceText(source: SourceInput) {
  return source.type === "input_text" ? source.text : `${source.filename}\n${source.file_data}`;
}

function sourceRef(source: SourceInput, index: number) {
  if (source.type === "input_file") return source.filename;
  const url = source.text.match(/参照URL:\s*(https?:\/\/\S+)/)?.[1];
  return url ?? `direct-input-${index + 1}`;
}

function passedStage(stage: string, inputs: string[], outputs: string[], validator: string, model?: string): StageLedgerEntry {
  return { stage, status: "passed", inputs, outputs, validator, ...(model ? { model } : {}) };
}

export function buildTeachingPackage(
  sources: SourceInput[],
  analysis: TeachingAnalysis,
  map: SlideMap,
  scripts: ScriptStage,
  freeze: ContentFreezeReview,
  model = "gpt-5.5",
): TeachingPackage {
  if (!freeze.passed || freeze.issues.length) throw new Error(`内容凍結QAに合格しませんでした: ${freeze.issues.join(" / ") || "理由未記録"}`);
  if (scripts.slides.length !== map.slides.length) throw new Error("講師台本が全スライドに対応していません。");

  const slides = map.slides.map((slide, index) => {
    const script = scripts.slides.find((item) => item.number === slide.number);
    if (!script || slide.number !== index + 1) throw new Error(`slide ${index + 1}: スライドマップと講師台本を対応づけられません。`);
    return { ...slide, speakerNotes: script.speakerNotes, ...calculateNarrationTiming(script.speakerNotes) };
  });
  const totalScriptCharacters = slides.reduce((sum, slide) => sum + slide.scriptCharacters, 0);
  const totalDurationSeconds = Math.round((totalScriptCharacters / 300) * 60);
  const processErrors = validateProcessDeck({
    processContract: PROCESS_CONTRACT_ID,
    designProfile: DESIGN_PROFILE_ID,
    slides,
    totalScriptCharacters,
    totalDurationSeconds,
  });
  const normalizedTitles = slides.map((slide) => slide.title.trim().toLocaleLowerCase("ja"));
  if (new Set(normalizedTitles).size !== normalizedTitles.length) processErrors.push("スライドタイトルが重複しています");
  if (processErrors.length) throw new Error(`内容凍結の機械検証に合格しませんでした: ${processErrors.join(" / ")}`);

  const sourceHash = createHash("sha256").update(sources.map(sourceText).join("\n\u241e\n")).digest("hex");
  const textStages = [
    passedStage("source_ingest", ["user_sources"], ["source_info", "source_hash"], "source-hash-and-reference", undefined),
    passedStage("analysis", ["normalized_source"], ["teaching_analysis"], "analysis-schema", model),
    passedStage("slide_map", ["teaching_analysis"], ["slide_map"], "slide-map-schema", model),
    passedStage("script_timing", ["slide_map", "normalized_source"], ["speaker_notes", "script_characters", "duration_seconds"], "300-characters-per-minute", model),
    passedStage("content_freeze", ["deck_spec", "normalized_source"], ["semantic_validation"], "machine-and-ai-freeze-gate", model),
    passedStage("design", ["frozen_deck", "design_profile"], ["layout_families", "image_prompts"], "shared-design-profile", undefined),
  ];
  const stageLedger = PROCESS_STAGES.map((stage) => textStages.find((entry) => entry.stage === stage) ?? {
    stage,
    status: "pending" as const,
    inputs: [],
    outputs: [],
    validator: "not-started",
  });

  const result: TeachingPackage = {
    designProfile: DESIGN_PROFILE_ID,
    title: map.title,
    targetAudience: analysis.targetAudience,
    durationMinutes: Math.max(1, Math.ceil(totalDurationSeconds / 60)),
    sourceSummary: map.sourceSummary,
    learningObjectives: map.learningObjectives,
    slides,
    scenario: scripts.scenario,
    faq: scripts.faq,
    quiz: scripts.quiz,
    process: {
      contract: PROCESS_CONTRACT_ID,
      source: { refs: sources.map(sourceRef), sourceHash },
      analysis,
      contentFreeze: freeze,
      imagePrompts: [],
      totalScriptCharacters,
      totalDurationSeconds,
      stageLedger,
    },
  };
  if (!result.process) throw new Error("工程証跡を作成できませんでした。");
  result.process.imagePrompts = result.slides.map((slide) => {
    const prompt = buildSlideImagePrompt(result, slide);
    return { slideNumber: slide.number, prompt, promptHash: createHash("sha256").update(prompt).digest("hex") };
  });
  return result;
}
