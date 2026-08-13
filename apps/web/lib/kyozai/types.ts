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
};

export type SourceInput =
  | { type: "input_text"; text: string }
  | { type: "input_file"; filename: string; file_data: string };
