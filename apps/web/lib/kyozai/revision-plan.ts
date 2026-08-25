import type { RevisionImpactScope } from "../../../../shared/kyozai-job-contract";

export type RevisionPlan = { impactScope: RevisionImpactScope; targetSlides: number[]; allowedFields: string[]; invariants: string[] };

/** Conservative classifier: uncertainty expands scope; it never silently calls a whole-deck rewrite local. */
export function planRevision(instruction: string, slideNumbers: number[]): RevisionPlan {
  const targets = [...instruction.matchAll(/(?:スライド|slide)\s*(\d+)/gi)].map((match) => Number(match[1])).filter((number) => slideNumbers.includes(number));
  const targetSlides = [...new Set(targets)];
  if (/順番|追加|削除|全体|構成|章|並べ替/i.test(instruction)) return { impactScope: "structural", targetSlides: targetSlides.length ? targetSlides : slideNumbers, allowedFields: ["slides"], invariants: ["source", "designProfile"] };
  if (/画像|配置|色|余白|見た目|レイアウト/i.test(instruction)) return { impactScope: "visual_only", targetSlides, allowedFields: ["layout", "image"], invariants: ["title", "bullets", "speakerNotes", "source"] };
  return { impactScope: "local_content", targetSlides, allowedFields: ["title", "keyMessage", "bullets", "speakerNotes"], invariants: ["source", "designProfile", "untargetedSlides"] };
}
