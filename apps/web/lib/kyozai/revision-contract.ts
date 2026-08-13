import type { TeachingPackage } from "./types";

export const REVISION_BODY_LIMIT_BYTES = 256 * 1024;
export const MAX_REVISION_ATTEMPTS = 3;

export type RevisionOperation = "text.replace" | "text.rewrite";
export type RevisionTarget =
  | { kind: "scalar"; slideNumber: number; field: "theme" | "title" | "keyMessage" }
  | { kind: "array-item"; slideNumber: number; field: "labels" | "bullets"; itemIndex: number };

export type RevisionPatch = {
  operation: RevisionOperation;
  target: RevisionTarget;
  expectedValue: string;
  expectedContainerValue: string[] | null;
  matchValue: string | null;
  replacementText: string | null;
  resultValue: string;
  maxCharacters: number | null;
};

export type RevisionPlan = {
  status: "planned" | "unsupported";
  operation: RevisionOperation | null;
  targetSlides: number[];
  patches: RevisionPatch[];
  failureCode: "unsupported_operation" | "ambiguous_scope" | null;
  message: string | null;
};

export type RevisionMetadata = {
  status: "promoted";
  operation: RevisionOperation;
  baseVersionId: string;
  candidateVersionId: string;
  parentVersionId: string;
  baseHash: string;
  candidateHash: string;
  targetSlides: number[];
  changedTargets: RevisionTarget[];
  attemptCount: number;
  validation: "passed";
};

export type RevisionFailureCode = "ambiguous_scope" | "unsupported_operation" | "invalid_plan" | "precondition_failed" | "scope_violation" | "provider_unavailable";
export type RejectedRevisionMetadata = { status: "rejected"; baseVersionId: string; baseHash: string; failureCode: RevisionFailureCode; attemptCount: number };
export type RevisionResult = { package: TeachingPackage; revision: RevisionMetadata };

export class RevisionError extends Error {
  constructor(message: string, readonly failureCode: RevisionFailureCode, readonly statusCode = 422, readonly attemptCount = 0) {
    super(message);
    this.name = "RevisionError";
  }
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const nullableInteger = { anyOf: [{ type: "integer", minimum: 1, maximum: 1000 }, { type: "null" }] } as const;
const nullableStringArray = { anyOf: [{ type: "array", items: { type: "string" }, maxItems: 4 }, { type: "null" }] } as const;

export const revisionPlanSchema = {
  type: "object",
  properties: {
    status: { enum: ["planned", "unsupported"] },
    operation: { anyOf: [{ enum: ["text.replace", "text.rewrite"] }, { type: "null" }] },
    targetSlides: {
      type: "array",
      description: "Exactly the distinct targetSlides supplied in the input; never repeat a slide number.",
      items: { type: "integer", minimum: 1, maximum: 999 },
      minItems: 1,
      maxItems: 3,
    },
    patches: {
      type: "array", minItems: 0, maxItems: 30,
      items: {
        type: "object",
        properties: {
          operation: { enum: ["text.replace", "text.rewrite"] },
          target: {
            type: "object",
            properties: {
              kind: { enum: ["scalar", "array-item"] },
              slideNumber: { type: "integer", minimum: 1, maximum: 999 },
              field: { enum: ["theme", "title", "keyMessage", "labels", "bullets"] },
              itemIndex: { anyOf: [{ type: "integer", minimum: 0, maximum: 3 }, { type: "null" }] },
            },
            required: ["kind", "slideNumber", "field", "itemIndex"], additionalProperties: false,
          },
          expectedValue: { type: "string", minLength: 1, maxLength: 1000 },
          expectedContainerValue: nullableStringArray,
          matchValue: nullableString,
          replacementText: nullableString,
          resultValue: { type: "string", minLength: 1, maxLength: 1000 },
          maxCharacters: nullableInteger,
        },
        required: ["operation", "target", "expectedValue", "expectedContainerValue", "matchValue", "replacementText", "resultValue", "maxCharacters"],
        additionalProperties: false,
      },
    },
    failureCode: { anyOf: [{ enum: ["unsupported_operation", "ambiguous_scope"] }, { type: "null" }] },
    message: nullableString,
  },
  required: ["status", "operation", "targetSlides", "patches", "failureCode", "message"], additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTarget(value: unknown): value is RevisionTarget {
  if (!isRecord(value) || !Number.isInteger(value.slideNumber) || Number(value.slideNumber) < 1 || Number(value.slideNumber) > 999) return false;
  if (value.kind === "scalar") return ["theme", "title", "keyMessage"].includes(String(value.field)) && value.itemIndex === null;
  return value.kind === "array-item" && ["labels", "bullets"].includes(String(value.field)) && Number.isInteger(value.itemIndex) && Number(value.itemIndex) >= 0 && Number(value.itemIndex) <= 3;
}

function isPatch(value: unknown): value is RevisionPatch {
  if (!isRecord(value) || !["text.replace", "text.rewrite"].includes(String(value.operation)) || !isTarget(value.target)) return false;
  if (typeof value.expectedValue !== "string" || !value.expectedValue || typeof value.resultValue !== "string" || !value.resultValue) return false;
  if (!(value.expectedContainerValue === null || (Array.isArray(value.expectedContainerValue) && value.expectedContainerValue.length <= 4 && value.expectedContainerValue.every((item) => typeof item === "string")))) return false;
  if (!(value.matchValue === null || typeof value.matchValue === "string") || !(value.replacementText === null || typeof value.replacementText === "string")) return false;
  if (!(value.maxCharacters === null || (Number.isInteger(value.maxCharacters) && Number(value.maxCharacters) > 0 && Number(value.maxCharacters) <= 1000))) return false;
  if (value.target.kind === "scalar" ? value.expectedContainerValue !== null : !Array.isArray(value.expectedContainerValue)) return false;
  if (value.operation === "text.replace") return Boolean(value.matchValue) && value.replacementText !== null && value.maxCharacters === null;
  return value.matchValue === null && value.replacementText === null;
}

export function isRevisionPlan(value: unknown): value is RevisionPlan {
  if (!isRecord(value) || !["planned", "unsupported"].includes(String(value.status))) return false;
  if (!(value.operation === null || value.operation === "text.replace" || value.operation === "text.rewrite")) return false;
  if (!Array.isArray(value.targetSlides) || value.targetSlides.length < 1 || value.targetSlides.length > 3 || !value.targetSlides.every((item) => Number.isInteger(item) && item >= 1 && item <= 999)) return false;
  if (new Set(value.targetSlides).size !== value.targetSlides.length) return false;
  if (!Array.isArray(value.patches) || value.patches.length > 30 || !value.patches.every(isPatch)) return false;
  if (!(value.failureCode === null || value.failureCode === "unsupported_operation" || value.failureCode === "ambiguous_scope")) return false;
  if (!(value.message === null || typeof value.message === "string")) return false;
  if (value.status === "unsupported") return value.operation === null && value.patches.length === 0 && value.failureCode !== null;
  return value.operation !== null && value.patches.length > 0 && value.failureCode === null && value.patches.every((patch) => patch.operation === value.operation);
}
