import profile from "./design-profile.json";
import type { LayoutFamily, Slide } from "./types";

export const DESIGN_PROFILE = profile;
export const DESIGN_PROFILE_ID = `${profile.id}@${profile.version}`;

export function splitItems(items: string[]): [string[], string[]] {
  const midpoint = Math.ceil(items.length / 2);
  return [items.slice(0, midpoint), items.slice(midpoint)];
}

export function slideDurationSeconds(slide: Slide): number {
  return Math.max(1, Math.round((slide.speakerNotes.length / profile.rules.scriptCharactersPerMinute) * 60));
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function layoutClass(layout: LayoutFamily): string {
  return `layout-${layout}`;
}

export function designInstructions(): string {
  return [
    `デザイン契約は${DESIGN_PROFILE_ID}です。designProfileは必ずこの値にしてください。`,
    "先頭はlayoutFamily=cover、末尾はlayoutFamily=actionにします。",
    "本文は内容に応じてfocus、compare、sequence、evidence、checklistを選び、同じlayoutFamilyを3枚連続させません。",
    "labelsは通常空配列にし、compareだけは内容固有の短い比較ラベルを必ず2つ入れます。A/Bのような抽象ラベルは禁止です。",
    "themeはその1枚だけで扱う主題、roleはintroduction、overview、understanding、example、practice、summary、actionから選びます。",
    `具体構図は次の共通定義を守ります: ${JSON.stringify(profile.layoutDefinitions)}`,
    "白背景、太い黒見出し、見出し直下の青線、鮮明な青の強調、薄いグレーの補助面を前提に表示内容を設計します。",
    "タイトルはその1枚の結論、bulletsは最大4項目の短文にし、長文段落や装飾目的の文言を置きません。",
    "表紙は講座固有の題名と到達点、最終スライドは受講後に行う具体的な1アクションを示します。",
    "speakerNotesはスライド表示文の読み上げではなく、理由・例・つなぎを含む話し言葉にします。",
  ].join("\n");
}
