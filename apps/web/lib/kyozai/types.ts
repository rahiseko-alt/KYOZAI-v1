export type LayoutFamily = "cover" | "focus" | "compare" | "sequence" | "evidence" | "checklist" | "action";

export type Slide = {
  number: number;
  layoutFamily: LayoutFamily;
  labels: string[];
  theme: string;
  role: "introduction" | "overview" | "understanding" | "example" | "practice" | "summary" | "action";
  title: string;
  keyMessage: string;
  bullets: string[];
  speakerNotes: string;
  composition?: string;
  scriptCharacters?: number;
  durationSeconds?: number;
};

export type TeachingAnalysis = {
  targetAudience: string;
  problem: string;
  outcome: string;
  coreClaim: string;
  evidence: string[];
  examples: string[];
  finalAction: string;
};

export type StageLedgerEntry = {
  stage: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  inputs: string[];
  outputs: string[];
  validator: string;
  model?: string;
};

export type ProcessEvidence = {
  contract: "kyozai-slide-process@1.0.0";
  source: {
    refs: string[];
    sourceHash: string;
  };
  analysis: TeachingAnalysis;
  contentFreeze: {
    passed: boolean;
    issues: string[];
  };
  imagePrompts: Array<{
    slideNumber: number;
    prompt: string;
    promptHash: string;
  }>;
  totalScriptCharacters: number;
  totalDurationSeconds: number;
  stageLedger: StageLedgerEntry[];
};

export type TeachingPackage = {
  designProfile: string;
  title: string;
  targetAudience: string;
  durationMinutes: number;
  sourceSummary: string;
  learningObjectives: string[];
  slides: Slide[];
  scenario: Array<{
    section: string;
    minutes: number;
    guidance: string;
  }>;
  faq: Array<{
    question: string;
    answer: string;
  }>;
  quiz: Array<{
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
  }>;
  process?: ProcessEvidence;
};

export type SourceInput =
  | { type: "input_text"; text: string }
  | { type: "input_file"; filename: string; file_data: string };
