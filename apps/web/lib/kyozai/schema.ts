import type { TeachingPackage } from "./types";
import { DESIGN_PROFILE_ID } from "./design";

const stringArray = {
  type: "array",
  items: { type: "string" },
} as const;

export const teachingPackageSchema = {
  type: "object",
  properties: {
    designProfile: { type: "string", enum: [DESIGN_PROFILE_ID] },
    title: { type: "string" },
    targetAudience: { type: "string" },
    durationMinutes: { type: "integer", minimum: 5, maximum: 180 },
    sourceSummary: { type: "string" },
    learningObjectives: { ...stringArray, minItems: 2, maxItems: 4 },
    slides: {
      type: "array",
      minItems: 4,
      maxItems: 8,
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
          speakerNotes: { type: "string" },
        },
        required: ["number", "layoutFamily", "labels", "theme", "role", "title", "keyMessage", "bullets", "speakerNotes"],
        additionalProperties: false,
      },
    },
    scenario: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          section: { type: "string" },
          minutes: { type: "integer", minimum: 1, maximum: 180 },
          guidance: { type: "string" },
        },
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
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
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
          answerIndex: { type: "integer", minimum: 0, maximum: 3 },
          explanation: { type: "string" },
        },
        required: ["question", "options", "answerIndex", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "designProfile",
    "title",
    "targetAudience",
    "durationMinutes",
    "sourceSummary",
    "learningObjectives",
    "slides",
    "scenario",
    "faq",
    "quiz",
  ],
  additionalProperties: false,
} as const;

export function isTeachingPackage(value: unknown): value is TeachingPackage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TeachingPackage>;
  const layouts = new Set(["cover", "focus", "compare", "sequence", "evidence", "checklist", "action"]);
  const roles = new Set(["introduction", "overview", "understanding", "example", "practice", "summary", "action"]);
  const hasValidSlides = Array.isArray(item.slides) && item.slides.length >= 4 && item.slides.length <= 8 && item.slides.every((slide, index) =>
    slide && typeof slide.number === "number" && slide.number === index + 1 && layouts.has(slide.layoutFamily) && Array.isArray(slide.labels) &&
    slide.labels.length <= 2 && slide.labels.every((label) => typeof label === "string") &&
    (slide.layoutFamily !== "compare" || slide.labels.length === 2) && typeof slide.theme === "string" && roles.has(slide.role) &&
    typeof slide.title === "string" && typeof slide.keyMessage === "string" && Array.isArray(slide.bullets) && slide.bullets.length >= 2 && slide.bullets.length <= 4 &&
    slide.bullets.every((bullet) => typeof bullet === "string") && typeof slide.speakerNotes === "string");
  const hasRequiredBookends = hasValidSlides && item.slides?.[0]?.layoutFamily === "cover" && item.slides.at(-1)?.layoutFamily === "action";
  const hasValidBodyLayouts = Boolean(hasValidSlides && item.slides?.slice(1, -1).every((slide) => slide.layoutFamily !== "cover" && slide.layoutFamily !== "action"));
  const hasLayoutVariety = Boolean(hasValidSlides && !item.slides?.some((slide, index, slides) => index >= 2 && slide.layoutFamily === slides[index - 1]?.layoutFamily && slide.layoutFamily === slides[index - 2]?.layoutFamily));
  const hasValidQuiz = Array.isArray(item.quiz) && item.quiz.length >= 3 && item.quiz.length <= 5 && item.quiz.every((quiz) =>
    quiz && typeof quiz.question === "string" && Array.isArray(quiz.options) && quiz.options.length >= 3 && quiz.options.length <= 4 &&
    quiz.options.every((option) => typeof option === "string") && Number.isInteger(quiz.answerIndex) &&
    quiz.answerIndex >= 0 && quiz.answerIndex < quiz.options.length && typeof quiz.explanation === "string");
  const hasValidScenario = Array.isArray(item.scenario) && item.scenario.length >= 3 && item.scenario.length <= 6 && item.scenario.every((section) =>
    section && typeof section.section === "string" && Number.isInteger(section.minutes) && section.minutes > 0 && section.minutes <= 180 && typeof section.guidance === "string");
  const hasValidFaq = Array.isArray(item.faq) && item.faq.length >= 3 && item.faq.length <= 6 && item.faq.every((faq) =>
    faq && typeof faq.question === "string" && typeof faq.answer === "string");
  return (
    item.designProfile === DESIGN_PROFILE_ID &&
    typeof item.title === "string" &&
    typeof item.targetAudience === "string" &&
    typeof item.durationMinutes === "number" && Number.isInteger(item.durationMinutes) && item.durationMinutes >= 5 && item.durationMinutes <= 180 &&
    typeof item.sourceSummary === "string" &&
    Array.isArray(item.learningObjectives) && item.learningObjectives.length >= 2 && item.learningObjectives.length <= 4 &&
    item.learningObjectives.every((objective) => typeof objective === "string") &&
    hasValidSlides && hasRequiredBookends && hasValidBodyLayouts && hasLayoutVariety && hasValidScenario && hasValidFaq && hasValidQuiz
  );
}
