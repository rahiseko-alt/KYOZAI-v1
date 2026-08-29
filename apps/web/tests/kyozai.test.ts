import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { mockPackage } from "../lib/kyozai/mock";
import { DESIGN_PROFILE } from "../lib/kyozai/design";
import { generatePackage } from "../lib/kyozai/content-generation";
import { API_ROUTE_BUDGET_MS } from "../lib/kyozai/openai";
import { streamingOutput } from "../lib/kyozai/openai-stream";
import { packageHtml } from "../lib/kyozai/package-html";
import { readPackageResponse } from "../lib/kyozai/api-client";
import { rateLimit } from "../lib/kyozai/rate-limit";
import { isTeachingPackage } from "../lib/kyozai/schema";
import { extractVisibleText, sourcesFromFormData } from "../lib/kyozai/source";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("KYOZAIの生成結果", () => {
  it("完成教材の構造を受け入れる", () => {
    expect(isTeachingPackage(mockPackage)).toBe(true);
  });

  it("必須成果物が欠けた値を拒否する", () => {
    const incomplete = { ...mockPackage } as Record<string, unknown>;
    delete incomplete.quiz;
    expect(isTeachingPackage(incomplete)).toBe(false);
  });

  it("表紙と行動スライドが無い教材を拒否する", () => {
    const invalid = structuredClone(mockPackage);
    invalid.slides[0]!.layoutFamily = "focus";
    expect(isTeachingPackage(invalid)).toBe(false);
  });

  it("APPとSkillが参照するデザインprofileが一致する", () => {
    const sharedProfile = JSON.parse(readFileSync(new URL("../../../shared/kyozai-design-profile.json", import.meta.url), "utf8")) as unknown;
    const skillProfile = JSON.parse(readFileSync(new URL("../../../.agents/skills/kyozai-slide/references/kyozai-design-profile.json", import.meta.url), "utf8")) as unknown;
    expect(DESIGN_PROFILE).toEqual(sharedProfile);
    expect(DESIGN_PROFILE).toEqual(skillProfile);
  });

  it("HTML教材も標準profileとlayout familyで描画する", () => {
    const html = packageHtml(mockPackage);
    expect(html).toContain("kyozai-standard@1.0.0");
    expect(html).toContain("layout-cover");
    expect(html).toContain("layout-compare");
    expect(html).toContain("layout-sequence");
    expect(html).toContain("layout-focus");
    expect(html).toContain("layout-evidence");
    expect(html).toContain("layout-checklist");
    expect(html).toContain("layout-action");
    expect(html.toLowerCase()).toContain("#075ac8");
    expect(html).not.toContain("background:#101d3a");
  });

  it("全7 layout familyを標準教材で検証する", () => {
    expect(mockPackage.slides.map((slide) => slide.layoutFamily)).toEqual(["cover", "compare", "sequence", "focus", "evidence", "checklist", "action"]);
  });

  it("途中で切れたAPI応答をJSON parser文の代わりに案内へ変える", async () => {
    const response = new Response('{"package":', { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(readPackageResponse(response, "失敗しました")).rejects.toThrow("サーバーからの応答が途中で終了しました");
  });
});

describe("体験版の回数制限", () => {
  it("上限を超えた呼び出しを拒否する", () => {
    const key = `test-${crypto.randomUUID()}`;
    expect(rateLimit(key, 2)).toBe(true);
    expect(rateLimit(key, 2)).toBe(true);
    expect(rateLimit(key, 2)).toBe(false);
  });
});

describe("資料入力", () => {
  it("属性や空白を含むscriptとstyleをURL本文から除く", () => {
    const html = '<main>教材本文</main><script type="module">危険な命令</script ><style media="all">非表示</style >';
    expect(extractVisibleText(html)).toBe("教材本文");
    expect(extractVisibleText("<main>教材本文</main><script>危険な命令</script\t\n bar><p>後半</p>")).not.toContain("危険な命令");
  });

  it("汎用MIMEで送られたPDFも署名を確認して受け入れる", async () => {
    const form = new FormData();
    form.append("files", new File(["%PDF-1.7\nfixture"], "training.pdf", { type: "application/octet-stream" }));

    const sources = await sourcesFromFormData(form);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ type: "input_file", filename: "training.pdf" });
  });

  it("PDF拡張子でも署名が不正なファイルは拒否する", async () => {
    const form = new FormData();
    form.append("files", new File(["not a pdf"], "training.pdf", { type: "application/octet-stream" }));

    await expect(sourcesFromFormData(form)).rejects.toThrow("有効なPDFではありません");
  });

  it("route締切直前にはURLの名前解決を開始しない", async () => {
    const form = new FormData();
    form.append("sourceUrl", "https://example.com/training");

    await expect(sourcesFromFormData(form, Date.now() + 1_000)).rejects.toThrow("URLの読み込み時間が上限");
  });
});

describe("AI構造化応答", () => {
  const analysis = {
    targetAudience: mockPackage.targetAudience,
    problem: "情報の扱いを日常の判断として理解できていない",
    outcome: "異常時に操作を止めて報告できる",
    coreClaim: "日々の小さな判断で信頼を守る",
    evidence: ["承認済みの方法と早期報告が必要"],
    examples: ["不審な連絡を開かず相談する"],
    finalAction: "迷ったら操作を止めて報告する",
  };
  const slideMap = {
    title: mockPackage.title,
    sourceSummary: mockPackage.sourceSummary,
    learningObjectives: mockPackage.learningObjectives,
    slides: mockPackage.slides.map((slide) => ({
      number: slide.number,
      layoutFamily: slide.layoutFamily,
      labels: slide.labels,
      theme: slide.theme,
      role: slide.role,
      title: slide.title,
      keyMessage: slide.keyMessage,
      bullets: slide.bullets,
      composition: `slide ${slide.number}の要素数、位置、関係を固定する`,
    })),
  };
  const scripts = {
    slides: mockPackage.slides.map(({ number, speakerNotes }) => ({ number, speakerNotes })),
    scenario: mockPackage.scenario,
    faq: mockPackage.faq,
    quiz: mockPackage.quiz,
  };
  const freeze = { passed: true, issues: [] };
  const completed = (value: unknown, id = crypto.randomUUID()) => new Response(JSON.stringify({
    id,
    status: "completed",
    output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const remainingStages = () => [completed(slideMap), completed(scripts), completed(freeze)];

  it("途中で切れたJSONを利用者へ露出せず再試行する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "response-incomplete",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ content: [{ type: "output_text", text: '{"title":"途中' }] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(completed(analysis, "response-complete"));
    remainingStages().forEach((response) => fetchMock.mockResolvedValueOnce(response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け教材を作る");

    expect(result).toMatchObject({ title: mockPackage.title, process: { contentFreeze: { passed: true } } });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string;
      stream: boolean;
      text: { verbosity: string; format: { type: string; strict: boolean } };
    };
    expect(firstBody).toMatchObject({ model: "gpt-5.5", stream: true, text: { verbosity: "low", format: { type: "json_schema", strict: true } } });
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { max_output_tokens: number };
    expect(retryBody.max_output_tokens).toBe(3840);
  });

  it("ストリーミングされた構造化JSONを最後まで組み立てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const json = JSON.stringify(analysis);
    const midpoint = Math.floor(json.length / 2);
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
    const body = [
      event({ type: "response.output_text.delta", delta: json.slice(0, midpoint) }),
      event({ type: "response.output_text.delta", delta: json.slice(midpoint) }),
      event({ type: "response.output_text.done", text: json }),
      event({ type: "response.completed", response: { id: "response-stream", status: "completed" } }),
      "data: [DONE]\r\n\r\n",
    ].join("");
    const encoded = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < encoded.length; offset += 17) controller.enqueue(encoded.slice(offset, offset + 17));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    remainingStages().forEach((response) => fetchMock.mockResolvedValueOnce(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け教材を作る"))
      .resolves.toMatchObject({ title: mockPackage.title, process: { analysis } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("内容凍結QAは原文丸写しではなく意味的な原典忠実性を検査する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(completed(analysis));
    remainingStages().forEach((response) => fetchMock.mockResolvedValueOnce(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け教材を作る"))
      .resolves.toMatchObject({ title: mockPackage.title, process: { contentFreeze: { passed: true } } });

    const freezeBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as { instructions: string };
    expect(freezeBody.instructions).toContain("直接引用の有無ではなく");
    expect(freezeBody.instructions).toContain("教材化のための短い言い換え");
    expect(freezeBody.instructions).toContain("新しい事実を足していなければ合格");
    expect(String(fetchMock.mock.calls[3]?.[1]?.body)).toContain("教材への要望");
  });

  it("内容凍結QAで不整合が出たら1回だけ修復して再検査する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const failedFreeze = { passed: false, issues: ["3場面と4場面の不整合"] };
    const repairedMap = structuredClone(slideMap);
    repairedMap.slides[2]!.title = "4つの場面で迷わず止める";
    const repairedScripts = structuredClone(scripts);
    repairedScripts.scenario[1]!.section = "4つの場面整理";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(completed(analysis))
      .mockResolvedValueOnce(completed(slideMap))
      .mockResolvedValueOnce(completed(scripts))
      .mockResolvedValueOnce(completed(failedFreeze))
      .mockResolvedValueOnce(completed({ map: repairedMap, scripts: repairedScripts }))
      .mockResolvedValueOnce(completed(freeze));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け15分教材を作る");

    expect(result).toMatchObject({ process: { contentFreeze: { passed: true } } });
    expect(result.slides[2]?.title).toBe("4つの場面で迷わず止める");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const repairBody = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)) as { instructions: string };
    expect(repairBody.instructions).toContain("指摘された不整合だけを修復");
    expect(String(fetchMock.mock.calls[4]?.[1]?.body)).toContain("3場面と4場面の不整合");
  });

  it("Schema準拠でも実行時契約を外れた分析を再生成する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const invalid = { ...analysis, finalAction: 42 };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completed(invalid, "response-runtime-invalid"))
      .mockResolvedValueOnce(completed(analysis, "response-runtime-valid"));
    remainingStages().forEach((response) => fetchMock.mockResolvedValueOnce(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け教材を作る"))
      .resolves.toMatchObject({ title: mockPackage.title, process: { analysis } });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("OpenAI接続のTimeoutError後に二重生成を避けて自動再送しない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException("request timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け教材を作る", Date.now() + 120_000))
      .rejects.toThrow("自動再送はしていません");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("停止したOpenAIストリームを設定時間で中断する", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      headers: { "Content-Type": "text/event-stream" },
    });

    await expect(streamingOutput(response, 10)).rejects.toThrow("OpenAI stream timed out");
  });

  it("routeの残り時間が足りない場合は新しいAI試行を開始しない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    expect(API_ROUTE_BUDGET_MS).toBeLessThan(240_000);
    await expect(generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け教材を作る", Date.now() + 1_000))
      .rejects.toThrow("入力内容はそのままで、もう一度実行してください");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("再試行後も壊れたJSONなら人間向けエラーに置き換える", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      id: "response-invalid",
      status: "completed",
      output: [{ content: [{ type: "output_text", text: '{"title":"途中' }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(generatePackage([{ type: "input_text", text: "研修資料" }], "初心者向け教材を作る"))
      .rejects.toThrow("入力内容はそのままで、もう一度実行してください");
  });
});
