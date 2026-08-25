import type { RevisionImpactScope } from "../../../../shared/kyozai-job-contract";

export type RevisionOperation = "text.replace" | "text.rewrite" | "visual.replace-image" | "visual.relayout-slide" | "visual.restyle-deck" | "slide.add" | "slide.remove" | "slide.move" | "source.correct" | "version.restore";
export type RevisionPlan = { operation: RevisionOperation; impactScope: RevisionImpactScope; targetSlides: number[]; allowedFields: string[]; invariants: string[] };

/** Conservative classifier: uncertainty expands scope; it never silently calls a whole-deck rewrite local. */
export function planRevision(instruction: string, slideNumbers: number[]): RevisionPlan {
  const targets = [...instruction.matchAll(/(?:スライド|slide)\s*(\d+)/gi)].map((match) => Number(match[1])).filter((number) => slideNumbers.includes(number));
  const targetSlides = [...new Set(targets)];
  if (/復元|restore/i.test(instruction)) return { operation: "version.restore", impactScope: "structural", targetSlides: slideNumbers, allowedFields: ["version"], invariants: ["source", "artifactHashes"] };
  if (/追加/i.test(instruction)) return { operation: "slide.add", impactScope: "structural", targetSlides: targetSlides.length ? targetSlides : slideNumbers, allowedFields: ["slides", "speakerNotes", "artifactReferences"], invariants: ["existingSlides"] };
  if (/削除/i.test(instruction)) return { operation: "slide.remove", impactScope: "structural", targetSlides, allowedFields: ["slides", "artifactReferences"], invariants: ["remainingSlides"] };
  if (/順番|入れ替|移動|並べ替/i.test(instruction)) return { operation: "slide.move", impactScope: "structural", targetSlides: targetSlides.length ? targetSlides : slideNumbers, allowedFields: ["slideOrder", "artifactReferences"], invariants: ["slideContent"] };
  if (/根拠|出典|資料.*訂正|数値.*更新/i.test(instruction)) return { operation: "source.correct", impactScope: "local_content", targetSlides, allowedFields: ["claims", "sourceReferences", "speakerNotes"], invariants: ["untargetedSlides", "designProfile"] };
  if (/全体.*(色|配色|デザイン)|アクセントカラー/i.test(instruction)) return { operation: "visual.restyle-deck", impactScope: "visual_only", targetSlides: slideNumbers, allowedFields: ["designTokens"], invariants: ["text", "layout", "images"] };
  if (/画像.*(変更|差し替)|イラスト.*差し替/i.test(instruction)) return { operation: "visual.replace-image", impactScope: "visual_only", targetSlides, allowedFields: ["image"], invariants: ["text", "speakerNotes", "layout"] };
  if (/配置|余白|重な|レイアウト|図表|列幅/i.test(instruction)) return { operation: "visual.relayout-slide", impactScope: "visual_only", targetSlides, allowedFields: ["layout"], invariants: ["text", "speakerNotes", "source"] };
  if (/変更|直して|修正/i.test(instruction) && /『.+』/.test(instruction)) return { operation: "text.replace", impactScope: "local_content", targetSlides, allowedFields: ["title", "keyMessage", "bullets", "speakerNotes"], invariants: ["source", "designProfile", "untargetedSlides"] };
  return { operation: "text.rewrite", impactScope: "local_content", targetSlides, allowedFields: ["title", "keyMessage", "bullets", "speakerNotes"], invariants: ["source", "designProfile", "untargetedSlides"] };
}
