import { createHash, randomUUID } from "node:crypto";

import {
  RevisionError,
  type RejectedRevisionMetadata,
  type RevisionPlan,
  type RevisionResult,
  type RevisionTarget,
} from "./revision-contract";
import { isTeachingPackage } from "./schema";
import type { TeachingPackage } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { MAX_REVISION_ATTEMPTS, REVISION_BODY_LIMIT_BYTES, RevisionError, isRevisionPlan, revisionPlanSchema } from "./revision-contract";
export type { RejectedRevisionMetadata, RevisionFailureCode, RevisionMetadata, RevisionOperation, RevisionPatch, RevisionPlan, RevisionResult, RevisionTarget } from "./revision-contract";

export function extractRevisionScope(request: string, selectedSlideNumber: number | undefined, totalSlides: number) {
  const normalized = request.normalize("NFKC");
  if (/(?:教材|スライド)全体|全スライド|すべてのスライド|全部のスライド/.test(normalized)) {
    throw new RevisionError("Phase 1では1〜3枚のスライドを指定してください。教材全体の修正は開発中です。", "unsupported_operation");
  }

  const explicit = [...normalized.matchAll(/(\d{1,3})\s*枚目/g)].map((match) => Number(match[1]));
  const usesSelected = normalized.includes("このスライド");
  if (!explicit.length && !usesSelected) {
    throw new RevisionError("「このスライド」または「3枚目」のように、修正するスライドを指定してください。", "ambiguous_scope");
  }
  if (usesSelected && (!selectedSlideNumber || selectedSlideNumber < 1 || selectedSlideNumber > totalSlides)) {
    throw new RevisionError("修正対象のスライドを選択してから、もう一度お試しください。", "ambiguous_scope");
  }
  if (usesSelected && explicit.length && !explicit.includes(selectedSlideNumber!)) {
    throw new RevisionError("「このスライド」と番号指定が一致していません。対象を1つに絞ってください。", "ambiguous_scope");
  }

  const targetSlides = [...new Set([...explicit, ...(usesSelected ? [selectedSlideNumber!] : [])])].sort((a, b) => a - b);
  if (targetSlides.length > 3) throw new RevisionError("一度に修正できるのは3枚までです。", "unsupported_operation");
  if (targetSlides.some((number) => number < 1 || number > totalSlides)) {
    throw new RevisionError("存在しないスライド番号が指定されています。", "ambiguous_scope");
  }
  return { targetSlides };
}

export function revisionInput(packageValue: TeachingPackage, targetSlides: number[], request: string) {
  return {
    request,
    targetSlides,
    slides: packageValue.slides
      .filter((slide) => targetSlides.includes(slide.number))
      .map(({ number, theme, title, keyMessage, labels, bullets }) => ({ number, theme, title, keyMessage, labels, bullets })),
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function packageHash(packageValue: TeachingPackage) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(packageValue)), "utf8").digest("hex");
}

function targetKey(target: RevisionTarget) {
  return target.kind === "scalar"
    ? `slides[${target.slideNumber - 1}].${target.field}`
    : `slides[${target.slideNumber - 1}].${target.field}[${target.itemIndex}]`;
}

function cleanTarget(target: RevisionTarget): RevisionTarget {
  if (target.kind === "scalar") {
    return { kind: "scalar", slideNumber: target.slideNumber, field: target.field };
  }
  return { kind: "array-item", slideNumber: target.slideNumber, field: target.field, itemIndex: target.itemIndex };
}

function sameArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function resolveTarget(packageValue: TeachingPackage, target: RevisionTarget) {
  const slide = packageValue.slides[target.slideNumber - 1];
  if (!slide || slide.number !== target.slideNumber) throw new RevisionError("修正対象のスライドを確認できませんでした。", "precondition_failed");
  if (target.kind === "scalar") return { value: slide[target.field], container: null as string[] | null };
  const container = slide[target.field];
  const value = container[target.itemIndex];
  if (typeof value !== "string") throw new RevisionError("修正対象の項目を確認できませんでした。", "precondition_failed");
  return { value, container };
}

function writeTarget(packageValue: TeachingPackage, target: RevisionTarget, value: string) {
  const slide = packageValue.slides[target.slideNumber - 1]!;
  if (target.kind === "scalar") slide[target.field] = value;
  else slide[target.field][target.itemIndex] = value;
}

function occurrenceCount(value: string, match: string) {
  if (!match) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = value.indexOf(match, cursor)) >= 0) {
    count += 1;
    cursor += match.length;
  }
  return count;
}

function diffPaths(before: unknown, after: unknown, path = ""): string[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [path];
    return before.flatMap((item, index) => diffPaths(item, after[index], `${path}[${index}]`));
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => diffPaths(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

function validatePlanBoundary(plan: RevisionPlan, targetSlides: number[]) {
  if (plan.status === "unsupported") {
    throw new RevisionError(plan.message || "この修正はPhase 1では対応していません。", plan.failureCode || "unsupported_operation");
  }
  if (!plan.operation || !plan.patches.length) throw new RevisionError("AIの修正計画を検証できませんでした。", "invalid_plan");
  if (new Set(plan.targetSlides).size !== plan.targetSlides.length) throw new RevisionError("修正対象のスライドが重複しています。", "invalid_plan");
  const plannedSlides = [...plan.targetSlides].sort((a, b) => a - b);
  if (!sameArray(plannedSlides.map(String), targetSlides.map(String))) throw new RevisionError("指定外のスライドが修正計画に含まれています。", "scope_violation");
  if (plan.patches.some((patch) => patch.operation !== plan.operation || !targetSlides.includes(patch.target.slideNumber))) {
    throw new RevisionError("指定外の修正が計画に含まれています。", "scope_violation");
  }
  const keys = plan.patches.map((patch) => targetKey(patch.target));
  if (new Set(keys).size !== keys.length) throw new RevisionError("同じ箇所への修正が重複しています。", "invalid_plan");
  if (targetSlides.some((slideNumber) => !plan.patches.some((patch) => patch.target.slideNumber === slideNumber))) {
    throw new RevisionError("指定されたスライドの修正内容がありません。", "invalid_plan");
  }
}

export function applyRevisionPlan(
  base: TeachingPackage,
  targetSlides: number[],
  plan: RevisionPlan,
  attemptCount: number,
  requestedBaseVersionId?: string,
): RevisionResult {
  validatePlanBoundary(plan, targetSlides);
  const candidate = structuredClone(base);
  const allowedPaths = new Set<string>();

  for (const patch of plan.patches) {
    const key = targetKey(patch.target);
    const resolved = resolveTarget(base, patch.target);
    if (resolved.value !== patch.expectedValue) throw new RevisionError("修正対象が計画時から変わっています。", "precondition_failed");
    if (patch.target.kind === "scalar") {
      if (patch.expectedContainerValue !== null) throw new RevisionError("修正計画の対象形式が一致しません。", "invalid_plan");
    } else {
      if (!patch.expectedContainerValue || !resolved.container || !sameArray(resolved.container, patch.expectedContainerValue)) {
        throw new RevisionError("箇条書きまたはラベルが計画時から変わっています。", "precondition_failed");
      }
      if (patch.expectedContainerValue[patch.target.itemIndex] !== patch.expectedValue) {
        throw new RevisionError("修正対象の配列要素が一致しません。", "precondition_failed");
      }
    }

    let nextValue: string;
    if (patch.operation === "text.replace") {
      if (!patch.matchValue || patch.replacementText === null || patch.maxCharacters !== null) {
        throw new RevisionError("置換計画の形式が正しくありません。", "invalid_plan");
      }
      if (occurrenceCount(resolved.value, patch.matchValue) !== 1) {
        throw new RevisionError("置換する文言を1件に特定できませんでした。", "precondition_failed");
      }
      nextValue = resolved.value.replace(patch.matchValue, patch.replacementText);
      if (nextValue !== patch.resultValue) throw new RevisionError("置換後の文言を検証できませんでした。", "precondition_failed");
    } else {
      if (patch.matchValue !== null || patch.replacementText !== null) throw new RevisionError("言い換え計画の形式が正しくありません。", "invalid_plan");
      nextValue = patch.resultValue;
      if (patch.maxCharacters !== null && [...nextValue].length > patch.maxCharacters) {
        throw new RevisionError("指定された文字数に収まっていません。", "precondition_failed");
      }
    }
    if (!nextValue.trim() || nextValue === resolved.value) throw new RevisionError("修正後の文言に変更がありません。", "precondition_failed");
    writeTarget(candidate, patch.target, nextValue);
    allowedPaths.add(key);
  }

  if (!isTeachingPackage(candidate)) throw new RevisionError("修正版の教材構造を検証できませんでした。", "scope_violation");
  const changes = diffPaths(base, candidate);
  if (!changes.length || changes.some((path) => !allowedPaths.has(path))) {
    throw new RevisionError("指定外の変更を検出したため、元の教材を維持しました。", "scope_violation");
  }

  const baseVersionId = requestedBaseVersionId || randomUUID();
  return {
    package: candidate,
    revision: {
      status: "promoted",
      operation: plan.operation!,
      baseVersionId,
      candidateVersionId: randomUUID(),
      parentVersionId: baseVersionId,
      baseHash: packageHash(base),
      candidateHash: packageHash(candidate),
      targetSlides,
      changedTargets: plan.patches.map((patch) => cleanTarget(patch.target)),
      attemptCount,
      validation: "passed",
    },
  };
}

export function rejectedRevision(base: TeachingPackage, error: RevisionError, baseVersionId?: string): RejectedRevisionMetadata {
  return {
    status: "rejected",
    baseVersionId: baseVersionId || randomUUID(),
    baseHash: packageHash(base),
    failureCode: error.failureCode,
    attemptCount: error.attemptCount,
  };
}
