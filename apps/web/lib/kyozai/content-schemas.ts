import type { ContentFreezeReview, ScriptStage, SlideMap } from "./content-pipeline";
import type { TeachingAnalysis } from "./types";

const stringArray = { type: "array", items: { type: "string" } } as const;

export const teachingAnalysisSchema = {
  type: "object",
  properties: {
    targetAudience: { type: "string" },
    problem: { type: "string" },
    outcome: { type: "string" },
    coreClaim: { type: "string" },
    evidence: { ...stringArray, minItems: 1, maxItems: 8 },
    examples: { ...stringArray, minItems: 0, maxItems: 8 },
    finalAction: { type: "string" },
  },
  required: ["targetAudience", "problem", "outcome", "coreClaim", "evidence", "examples", "finalAction"],
  additionalProperties: false,
} as const;

export const slideMapSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    sourceSummary: { type: "string" },
    learningObjectives: { ...stringArray, minItems: 2, maxItems: 4 },
    slides: {
      type: "array",
      minItems: 4,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          layoutFamily: { type: "string", enum: ["cover", "focus", "compare", "sequence", "evidence", "checklist", "action"] },
          labels: { ...stringArray, minItems: 0, maxItems: 2 },
          theme: { type: "string" },
          role: { type: "string", enum: ["introduction", "overview", "understanding", "example", "practice", "summary", "action"] },
          title: { type: "string" },
          keyMessage: { type: "string" },
          bullets: { ...stringArray, minItems: 2, maxItems: 4 },
          composition: { type: "string" },
        },
        required: ["number", "layoutFamily", "labels", "theme", "role", "title", "keyMessage", "bullets", "composition"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "sourceSummary", "learningObjectives", "slides"],
  additionalProperties: false,
} as const;

export const scriptStageSchema = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      minItems: 4,
      maxItems: 12,
      items: {
        type: "object",
        properties: { number: { type: "integer" }, speakerNotes: { type: "string" } },
        required: ["number", "speakerNotes"],
        additionalProperties: false,
      },
    },
    scenario: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        properties: { section: { type: "string" }, minutes: { type: "integer" }, guidance: { type: "string" } },
        required: ["section", "minutes", "guidance"],
        additionalProperties: false,
      },
    },
    faq: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer: { type: "string" } },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
    quiz: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { ...stringArray, minItems: 3, maxItems: 4 },
          answerIndex: { type: "integer" },
          explanation: { type: "string" },
        },
        required: ["question", "options", "answerIndex", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["slides", "scenario", "faq", "quiz"],
  additionalProperties: false,
} as const;

export const contentFreezeSchema = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    issues: { ...stringArray, maxItems: 12 },
  },
  required: ["passed", "issues"],
  additionalProperties: false,
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export function isTeachingAnalysis(value: unknown): value is TeachingAnalysis {
  if (!record(value)) return false;
  return ["targetAudience", "problem", "outcome", "coreClaim", "finalAction"].every((key) => typeof value[key] === "string") &&
    Array.isArray(value.evidence) && Array.isArray(value.examples);
}

export function isSlideMap(value: unknown): value is SlideMap {
  if (!record(value) || typeof value.title !== "string" || typeof value.sourceSummary !== "string" || !Array.isArray(value.learningObjectives) || !Array.isArray(value.slides)) return false;
  return value.slides.length >= 4 && value.slides.length <= 12 && value.slides.every((slide, index) =>
    record(slide) && slide.number === index + 1 && typeof slide.title === "string" && typeof slide.composition === "string" && Array.isArray(slide.bullets) && Array.isArray(slide.labels));
}

export function isScriptStage(value: unknown): value is ScriptStage {
  if (!record(value) || !Array.isArray(value.slides) || !Array.isArray(value.scenario) || !Array.isArray(value.faq) || !Array.isArray(value.quiz)) return false;
  return value.slides.every((slide, index) => record(slide) && slide.number === index + 1 && typeof slide.speakerNotes === "string");
}

export function isContentFreezeReview(value: unknown): value is ContentFreezeReview {
  return record(value) && typeof value.passed === "boolean" && Array.isArray(value.issues) && value.issues.every((issue) => typeof issue === "string");
}
