import type { Slide, TeachingPackage } from "./types";
import { DESIGN_PROFILE } from "./design";

function quotedList(label: string, values: string[]) {
  return [`${label}:`, ...values.map((value) => `- "${value}"`)].join("\n");
}

function designTokenSummary() {
  const { canvas, palette, typography, spacing, layoutDefinitions } = DESIGN_PROFILE;
  return [
    `Canvas: ${canvas.width} x ${canvas.height}, ${canvas.ratio}`,
    `Color palette: background ${palette.background}, text ${palette.text}, primary blue ${palette.primary}, primary dark ${palette.primaryDark}, secondary background ${palette.secondaryBackground}, border ${palette.border}, muted ${palette.muted}`,
    `Typography: ${typography.family}; title weight ${typography.titleWeight}; body weight ${typography.bodyWeight}; letter spacing ${typography.letterSpacing}`,
    `Spacing: outer margin ${spacing.outerPercent}%, title rule ${spacing.titleRulePixels}px, modest radius ${spacing.radiusPixels}px`,
    `Common layout definition: ${JSON.stringify(layoutDefinitions.common)}`,
  ].join("\n");
}

export function buildSlideImagePrompt(result: TeachingPackage, slide: Slide, retryIssues: string[] = []) {
  const exactText = [slide.title, slide.keyMessage, ...slide.labels, ...slide.bullets].filter(Boolean);
  const layoutDefinition = DESIGN_PROFILE.layoutDefinitions[slide.layoutFamily];
  const composition = slide.composition || "Use the shared layout definition and make the number, position, and relationship of all visual elements explicit.";
  return [
    "Use case: productivity-visual / scientific-educational",
    "Asset type: Japanese teaching slide",
    "Primary request: 確定済みの1スライドを完成画像として描画する。日本企業向け研修教材として、講師がそのまま使える完成スライドにする。",
    "Reference image: none. デザイントークンのみ参照し、写真素材や装飾背景で雰囲気を作らない。",
    `Deck title: ${result.title}`,
    `Target audience: ${result.targetAudience}`,
    `Slide: ${slide.number}/${result.slides.length}`,
    `Role: ${slide.role}`,
    `Theme: ${slide.theme}`,
    `Layout family: ${slide.layoutFamily}`,
    `Layout definition: ${typeof layoutDefinition === "string" ? layoutDefinition : JSON.stringify(layoutDefinition)}`,
    `Composition: ${composition}`,
    designTokenSummary(),
    quotedList("Text (verbatim): draw only these Japanese strings exactly as written. 言い換え、翻訳、省略、文字追加をしない", exactText),
    "Forbidden text: do not add headings or helper labels that are not listed in Text (verbatim), including 「研修の到達点」「ポイント」「まとめ」「課題」「解決策」「チェック」「STEP」「重要」.",
    "Visual hierarchy: title is the dominant conclusion headline; key message is second; bullets and labels are supporting information. Make the main visual structure immediately understandable at 25% scale.",
    "Graphics: use simple black-and-blue line diagrams, arrows, number circles, checkmarks, labels, and gray panels only when they explain the slide theme. The diagram must follow the Composition field.",
    "Constraints: 16:9, one theme per slide, white background, generous margins, no text clipping, no overlap, no dense paragraphs, no speaker notes inside the canvas, readable on a smartphone full-slide view.",
    "Avoid: 余計な文字、ロゴ、透かし、写真調背景、装飾優先、同一構成の反復、人物写真、3D表現、グラデーション、過度な影、AIロボット、回路、青い発光、ページ外文字。",
    retryIssues.length ? `前回の不合格理由だけを修正する: ${retryIssues.join(" / ")}` : "初回生成。",
  ].join("\n");
}
