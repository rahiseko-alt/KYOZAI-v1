import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDesignedPackage,
  generatePackage,
  generateScriptTiming,
  generateSlideMap,
  generateTeachingAnalysis,
  runContentFreezeGate,
} from "../lib/kyozai/content-generation";
import { mockPackage } from "../lib/kyozai/mock";

const sources = [{ type: "input_text" as const, text: "研修資料" }];
const analysis = mockPackage.process!.analysis;
const map = {
  title: mockPackage.title,
  sourceSummary: mockPackage.sourceSummary,
  learningObjectives: mockPackage.learningObjectives,
  slides: mockPackage.slides.map((slide) => ({
    number: slide.number, layoutFamily: slide.layoutFamily, labels: slide.labels,
    theme: slide.theme, role: slide.role, title: slide.title, keyMessage: slide.keyMessage,
    bullets: slide.bullets, composition: slide.composition!,
  })),
};
const scripts = {
  slides: mockPackage.slides.map(({ number, speakerNotes }) => ({ number, speakerNotes })),
  scenario: mockPackage.scenario, faq: mockPackage.faq, quiz: mockPackage.quiz,
};

function completed(value: unknown) {
  return new Response(JSON.stringify({
    id: crypto.randomUUID(), status: "completed",
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { headers: { "Content-Type": "application/json" } });
}

function requestText(call: [input: string | Request | URL, init?: RequestInit]) {
  const body = JSON.parse(String(call[1]?.body)) as { input: Array<{ content: Array<{ text?: string }> }> };
  return body.input[0]!.content.map((content) => content.text ?? "").join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("durable content stages", () => {
  it("persists a self-contained result at every paid content boundary", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completed(analysis))
      .mockResolvedValueOnce(completed(map))
      .mockResolvedValueOnce(completed(scripts))
      .mockResolvedValueOnce(completed({ passed: true, issues: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const savedAnalysis = await generateTeachingAnalysis(sources, "初心者向け教材を作る");
    const savedMap = await generateSlideMap(sources, "初心者向け教材を作る", savedAnalysis);
    const savedScripts = await generateScriptTiming(sources, "初心者向け教材を作る", savedAnalysis, savedMap);
    const gate = await runContentFreezeGate(sources, "初心者向け教材を作る", savedAnalysis, savedMap, savedScripts);

    expect(gate).toMatchObject({ review: { passed: true, issues: [] }, map, scripts, repaired: false });
    expect(buildDesignedPackage(sources, savedAnalysis, gate.map, gate.scripts, gate.review))
      .toMatchObject({ process: { analysis, contentFreeze: { passed: true } } });
    expect(requestText(fetchMock.mock.calls[1]!)).toContain(JSON.stringify(analysis));
    expect(requestText(fetchMock.mock.calls[2]!)).toContain(JSON.stringify(map));
  });

  it("records only the current content stage before each provider boundary", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completed(analysis))
      .mockResolvedValueOnce(completed(map))
      .mockResolvedValueOnce(completed(scripts))
      .mockResolvedValueOnce(completed({ passed: true, issues: [] })));
    const started: string[] = [];

    await generatePackage(sources, "初心者向け教材を作る", Number.POSITIVE_INFINITY, undefined, async (stage) => {
      started.push(stage);
    });

    expect(started).toEqual(["analysis", "slide_map", "script_timing", "content_freeze", "design"]);
  });

  it("does not produce a designable deck when content freeze remains rejected", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const rejected = { passed: false, issues: ["CTAが具体的でない"] };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completed(rejected))
      .mockResolvedValueOnce(completed({ map, scripts }))
      .mockResolvedValueOnce(completed(rejected)));

    const gate = await runContentFreezeGate(sources, "初心者向け教材を作る", analysis, map, scripts);

    expect(gate.review).toEqual(rejected);
    expect(() => buildDesignedPackage(sources, analysis, gate.map, gate.scripts, gate.review))
      .toThrow("内容凍結QAに合格しませんでした");
  });
});
