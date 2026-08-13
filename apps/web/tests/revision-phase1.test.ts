import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mockPackage } from "../lib/kyozai/mock";
import {
  RevisionError,
  applyRevisionPlan,
  extractRevisionScope,
  packageHash,
  type RevisionPatch,
  type RevisionPlan,
  type RevisionTarget,
} from "../lib/kyozai/revision";
import { canPromoteRevision, initialVersion, moveVersion, promoteRevision } from "../lib/kyozai/version-history";
import type { TeachingPackage } from "../lib/kyozai/types";

type SuccessCase = { id: string; operation: "text.replace" | "text.rewrite"; target: [number, string, number?]; match?: string; result: string };
type RejectCase = { id: string; kind: string; failureCode: string };
type VersionCase = { id: string; kind: string };
type Fixture = { groups: Array<{ id: string; cases: Array<SuccessCase | RejectCase | VersionCase> }> };

const fixture = JSON.parse(readFileSync(new URL("../../../shared/fixtures/revision-phase1/benchmark.json", import.meta.url), "utf8")) as Fixture;
const group = <T>(id: string) => fixture.groups.find((entry) => entry.id === id)!.cases as T[];

function targetFrom(entry: SuccessCase): RevisionTarget {
  const [slideNumber, field, itemIndex] = entry.target;
  return itemIndex === undefined
    ? { kind: "scalar", slideNumber, field: field as "theme" | "title" | "keyMessage" }
    : { kind: "array-item", slideNumber, field: field as "labels" | "bullets", itemIndex };
}

function currentValue(packageValue: TeachingPackage, target: RevisionTarget) {
  const slide = packageValue.slides[target.slideNumber - 1]!;
  return target.kind === "scalar" ? slide[target.field] : slide[target.field][target.itemIndex]!;
}

function currentContainer(packageValue: TeachingPackage, target: RevisionTarget) {
  if (target.kind === "scalar") return null;
  return packageValue.slides[target.slideNumber - 1]![target.field];
}

function rewritePatch(packageValue: TeachingPackage, target: RevisionTarget, resultValue: string): RevisionPatch {
  return {
    operation: "text.rewrite",
    target,
    expectedValue: currentValue(packageValue, target),
    expectedContainerValue: currentContainer(packageValue, target),
    matchValue: null,
    replacementText: null,
    resultValue,
    maxCharacters: null,
  };
}

function replacePatch(packageValue: TeachingPackage, target: RevisionTarget, matchValue: string, resultValue: string): RevisionPatch {
  const expectedValue = currentValue(packageValue, target);
  const position = expectedValue.indexOf(matchValue);
  const prefix = expectedValue.slice(0, position);
  const suffix = expectedValue.slice(position + matchValue.length);
  return {
    operation: "text.replace",
    target,
    expectedValue,
    expectedContainerValue: currentContainer(packageValue, target),
    matchValue,
    replacementText: resultValue.slice(prefix.length, resultValue.length - suffix.length),
    resultValue,
    maxCharacters: null,
  };
}

function plan(operation: "text.replace" | "text.rewrite", slideNumber: number, patch: RevisionPatch): RevisionPlan {
  return { status: "planned", operation, targetSlides: [slideNumber], patches: [patch], failureCode: null, message: null };
}

function revision(base = structuredClone(mockPackage), baseVersionId?: string) {
  const target: RevisionTarget = { kind: "scalar", slideNumber: 1, field: "title" };
  return applyRevisionPlan(base, [1], plan("text.rewrite", 1, rewritePatch(base, target, "情報管理の第一歩")), 1, baseVersionId);
}

function rejectionPlan(kind: string, base: TeachingPackage) {
  const scalar: RevisionTarget = { kind: "scalar", slideNumber: 1, field: "title" };
  const arrayItem: RevisionTarget = { kind: "array-item", slideNumber: 2, field: "bullets", itemIndex: 0 };
  const valid = plan("text.rewrite", 1, rewritePatch(base, scalar, "情報管理の第一歩"));
  switch (kind) {
    case "unsupported-plan": return { ...valid, status: "unsupported" as const, operation: null, patches: [], failureCode: "unsupported_operation" as const };
    case "plan-target-mismatch": return { ...valid, targetSlides: [2] };
    case "patch-out-of-scope": return plan("text.rewrite", 1, rewritePatch(base, { ...scalar, slideNumber: 2 }, "共有を確認する"));
    case "duplicate-target": return { ...valid, patches: [valid.patches[0]!, rewritePatch(base, scalar, "情報管理の基本") ] };
    case "expected-value-mismatch": return { ...valid, patches: [{ ...valid.patches[0]!, expectedValue: "古い見出し" }] };
    case "replace-no-match": return plan("text.replace", 1, replacePatch(base, scalar, "存在しない語", "情報管理の基本"));
    case "replace-many-matches": return plan("text.replace", 1, replacePatch(base, scalar, "情報", "安全情報の基本"));
    case "replace-false-postcondition": return plan("text.replace", 1, { ...replacePatch(base, scalar, "入門", "情報セキュリティ基礎"), resultValue: "異なる結果" });
    case "scalar-container": return { ...valid, patches: [{ ...valid.patches[0]!, expectedContainerValue: [] }] };
    case "array-missing-container": return plan("text.rewrite", 2, { ...rewritePatch(base, arrayItem, "承認済みの保存場所を使う"), expectedContainerValue: null });
    case "array-reordered-container": return plan("text.rewrite", 2, { ...rewritePatch(base, arrayItem, "承認済みの保存場所を使う"), expectedContainerValue: [...base.slides[1]!.bullets].reverse() });
    case "array-invalid-index": return plan("text.rewrite", 2, rewritePatch(base, { ...arrayItem, itemIndex: 9 }, "項目"));
    case "rewrite-replace-fields": return plan("text.rewrite", 1, { ...valid.patches[0]!, matchValue: "入門", replacementText: "基礎" });
    case "rewrite-no-change": return plan("text.rewrite", 1, rewritePatch(base, scalar, base.slides[0]!.title));
    case "rewrite-over-max": return plan("text.rewrite", 1, { ...valid.patches[0]!, resultValue: "情報管理の基本", maxCharacters: 1 });
    default: throw new Error(`Unknown rejection case: ${kind}`);
  }
}

describe("KYOZAI Revise Phase 1 fixture", () => {
  it("is a complete 20/20/10 acceptance set", () => {
    expect(fixture.groups.map((entry) => entry.id)).toEqual(["success", "reject", "version-flow"]);
    expect(group<SuccessCase>("success")).toHaveLength(20);
    expect(group<RejectCase>("reject")).toHaveLength(20);
    expect(group<VersionCase>("version-flow")).toHaveLength(10);
  });

  it.each(group<SuccessCase>("success"))("$id promotes only its declared text target", (entry) => {
    const base = structuredClone(mockPackage);
    const target = targetFrom(entry);
    const patch = entry.operation === "text.replace"
      ? replacePatch(base, target, entry.match!, entry.result)
      : rewritePatch(base, target, entry.result);
    const result = applyRevisionPlan(base, [target.slideNumber], plan(entry.operation, target.slideNumber, patch), 1, "base-success");

    expect(currentValue(result.package, target)).toBe(entry.result);
    expect(result.revision).toMatchObject({ baseVersionId: "base-success", parentVersionId: "base-success", targetSlides: [target.slideNumber], changedTargets: [target], validation: "passed" });
    expect(result.revision.baseHash).toBe(packageHash(base));
    expect(result.revision.candidateHash).not.toBe(result.revision.baseHash);
    const changed = structuredClone(result.package);
    if (target.kind === "scalar") changed.slides[target.slideNumber - 1]![target.field] = currentValue(base, target);
    else changed.slides[target.slideNumber - 1]![target.field][target.itemIndex] = currentValue(base, target);
    expect(changed).toEqual(base);
  });

  it.each(group<RejectCase>("reject"))("$id rejects and retains the base package", (entry) => {
    const base = structuredClone(mockPackage);
    if (entry.kind === "replace-many-matches") base.slides[0]!.title = "情報情報の基本";
    const snapshot = structuredClone(base);
    const scopeCases: Record<string, [string, number | undefined]> = {
      "scope-global": ["教材全体を短くしてください", 1],
      "scope-missing": ["見出しを短くしてください", 1],
      "scope-conflict": ["このスライドと2枚目を短くしてください", 1],
      "scope-four": ["1枚目、2枚目、3枚目、4枚目を短くしてください", undefined],
      "scope-out-of-range": ["8枚目を短くしてください", undefined],
    };
    const run = () => {
      const scope = scopeCases[entry.kind];
      if (scope) return extractRevisionScope(scope[0], scope[1], base.slides.length);
      const targetSlides = entry.kind.startsWith("array-") ? [2] : [1];
      return applyRevisionPlan(base, targetSlides, rejectionPlan(entry.kind, base), 1, "base-reject");
    };

    try {
      run();
      throw new Error("Expected a RevisionError");
    } catch (error) {
      expect(error).toBeInstanceOf(RevisionError);
      expect((error as RevisionError).failureCode).toBe(entry.failureCode);
    }
    expect(base).toEqual(snapshot);
    expect(packageHash(base)).toBe(packageHash(snapshot));
  });

  it.each(group<VersionCase>("version-flow"))("$id follows the linear version contract", (entry) => {
    const base = structuredClone(mockPackage);
    const result = revision(base, "base-version");
    const initial = initialVersion(base);
    const promoted = promoteRevision(initial, 0, result.package, result.revision);
    switch (entry.kind) {
      case "hash-deterministic": expect(packageHash(base)).toBe(packageHash(structuredClone(base))); break;
      case "candidate-hash-and-parent": expect(result.revision).toMatchObject({ parentVersionId: "base-version", baseVersionId: "base-version" }); expect(result.revision.candidateHash).not.toBe(result.revision.baseHash); break;
      case "provided-base-id": expect(result.revision.baseVersionId).toBe("base-version"); break;
      case "initial-history": expect(initial).toMatchObject({ index: 0 }); expect(initial.entries).toHaveLength(1); break;
      case "undo": expect(moveVersion(promoted, -1).index).toBe(0); break;
      case "redo": expect(moveVersion(moveVersion(promoted, -1), 1).index).toBe(1); break;
      case "redo-truncation": {
        const second = revision(promoted.entries[0]!.package, result.revision.baseVersionId);
        const branched = promoteRevision(moveVersion(promoted, -1), 0, second.package, second.revision);
        expect(branched.entries).toHaveLength(2);
        expect(branched.entries[1]!.id).toBe(second.revision.candidateVersionId);
        break;
      }
      case "stale-index": expect(canPromoteRevision(promoted, 0, "base-version", result.package, result.revision)).toBe(false); break;
      case "stale-base-id": expect(canPromoteRevision(initial, 0, "other-base", result.package, result.revision)).toBe(false); break;
      case "history-boundaries": expect(moveVersion(initial, -1).index).toBe(0); expect(moveVersion(promoted, 1).index).toBe(1); break;
      default: throw new Error(`Unknown version flow: ${entry.kind}`);
    }
  });

  it("forged base or candidate hashes never promote", () => {
    const base = structuredClone(mockPackage);
    const result = revision(base, "base-version");
    const initial = initialVersion(base);
    expect(canPromoteRevision(initial, 0, undefined, result.package, { ...result.revision, baseHash: "0".repeat(64) })).toBe(false);
    expect(canPromoteRevision(initial, 0, undefined, result.package, { ...result.revision, candidateHash: "0".repeat(64) })).toBe(false);
  });
});
