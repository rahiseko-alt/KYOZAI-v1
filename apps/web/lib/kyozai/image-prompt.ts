import type { Slide, TeachingPackage } from "./types";

export function buildSlideImagePrompt(result: TeachingPackage, slide: Slide, retryIssues: string[] = []) {
  const exactText = [slide.title, slide.keyMessage, ...slide.labels, ...slide.bullets].filter(Boolean);
  return [
    "日本企業向け研修教材の完成スライドを1枚だけ生成する。",
    "16:9の横長。白背景、黒文字、アクセントは#075AC8。フラットで実務的、投影とスマートフォンの両方で読みやすくする。",
    `教材: ${result.title}`,
    `対象: ${result.targetAudience}`,
    `ページ: ${slide.number}/${result.slides.length}`,
    `役割: ${slide.role}`,
    `レイアウト: ${slide.layoutFamily}`,
    `テーマ: ${slide.theme}`,
    `具体構図: ${slide.composition || "共通profileのlayout definitionに従い、表示要素の数・位置・関係を明確にする"}`,
    "次の日本語だけを一字一句そのまま表示する。言い換え、翻訳、省略、文字追加をしない。",
    ...exactText.map((text, index) => `${index + 1}. ${text}`),
    "図の要素数、位置、関係を具体構図どおりに描く。タイトルを最上位、要点を次位とし、十分な余白を取る。",
    "ロゴ、透かし、ページ外の文字、飾りだけの写真、人物写真、3D表現、グラデーション、過度な影を入れない。",
    retryIssues.length ? `前回の不合格理由だけを修正する: ${retryIssues.join(" / ")}` : "初回生成。",
  ].join("\n");
}
