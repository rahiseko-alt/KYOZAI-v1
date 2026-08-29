"use client";
import {
  BookOpenText,
  Check,
  Clock3,
  Download,
  FileText,
  Link2,
  MessageSquareText,
  Presentation,
  Send,
  Sparkles,
  UploadCloud,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HOME_HEADING } from "../lib/content";
import { readPackageResponse, readRenderedSlideResponse } from "../lib/kyozai/api-client";
import type { ImageModelId } from "../lib/kyozai/image-models";
import type { RenderedSlideImage } from "../lib/kyozai/image-types";
import { createMontagePng } from "../lib/kyozai/montage";
import { createTeachingPackageZip } from "../lib/kyozai/package-zip";
import { clearPersonalPackage, loadPersonalPackage, savePersonalPackage } from "../lib/kyozai/personal-storage";
import type { TeachingPackage } from "../lib/kyozai/types";
import { AppHeader, DevBadge } from "./app-header";
import { GeneratingView, type GenerationProgress } from "./generating-view";
import { ImageModelPicker } from "./image-model-picker";
import { SlidePreview } from "./slide-preview";
type Step = "input" | "generating" | "complete";
type Tab = "slides" | "scenario" | "faq" | "quiz";
export function Workspace() {
  const [step, setStep] = useState<Step>("input");
  const [files, setFiles] = useState<File[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [request, setRequest] = useState("新入社員向けの30分研修。初心者にもわかる表現で、具体例を入れてください。");
  const [result, setResult] = useState<TeachingPackage | null>(null);
  const [images, setImages] = useState<RenderedSlideImage[]>([]);
  const [imageModel, setImageModel] = useState<ImageModelId | null>(null);
  const [progress, setProgress] = useState<GenerationProgress>({ phase: "content", completed: 0, total: 0 });
  const [tab, setTab] = useState<Tab>("slides");
  const [slideIndex, setSlideIndex] = useState(0);
  const [revision, setRevision] = useState("");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    void loadPersonalPackage().then((saved) => {
      if (!saved || saved.images.length !== saved.package.slides.length) return;
      setResult(saved.package);
      setImages(saved.images);
      setStep("complete");
    }).catch(() => undefined);
  }, []);
  const onFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted = Array.from(incoming).filter((file) => file.size <= 2 * 1024 * 1024 && (["application/pdf", "text/plain", "text/markdown"].includes(file.type) || /\.(txt|md)$/i.test(file.name)));
    setFiles(accepted.slice(0, 2));
    if (accepted.length !== incoming.length) setError("PDF・TXT・Markdownの2MB以下のファイルを指定してください。");
    else setError("");
  };
  const renderImages = async (next: TeachingPackage, modelId: ImageModelId, renderGrant: string, previous?: TeachingPackage, previousImages: RenderedSlideImage[] = []) => {
    const retained = new Map<number, RenderedSlideImage>();
    if (previous) {
      next.slides.forEach((slide) => {
        const oldSlide = previous.slides.find((item) => item.number === slide.number);
        const oldImage = previousImages.find((item) => item.slideNumber === slide.number && item.modelId === modelId);
        if (oldSlide && oldImage && JSON.stringify(oldSlide) === JSON.stringify(slide)) retained.set(slide.number, oldImage);
      });
    }
    const pending = next.slides.filter((slide) => !retained.has(slide.number));
    let completed = retained.size;
    setProgress({ phase: "images", completed, total: next.slides.length });
    const generated = new Map<number, RenderedSlideImage>();
    for (const slide of pending) {
      const response = await fetch("/api/render-slide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: next, slideNumber: slide.number, imageModel: modelId, renderGrant }),
      });
      generated.set(slide.number, await readRenderedSlideResponse(response));
      completed += 1;
      setProgress({ phase: "images", completed, total: next.slides.length });
    }
    const complete = next.slides.map((slide) => retained.get(slide.number) ?? generated.get(slide.number)).filter((image): image is RenderedSlideImage => Boolean(image));
    if (complete.length !== next.slides.length) throw new Error("完成画像が全ページ揃わなかったため、旧版を維持しました。");
    return complete;
  };
  const generate = async () => {
    if (!files.length && !sourceText.trim() && !sourceUrl.trim()) {
      setError("資料、URL、またはテキストを1つ以上追加してください。");
      return;
    }
    if (!imageModel) {
      setError("画像生成モデルを選択してください。");
      return;
    }
    const selectedModel = imageModel;
    setError("");
    setStep("generating");
    setProgress({ phase: "content", completed: 0, total: 0 });
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.append("sourceUrl", sourceUrl);
    form.append("sourceText", sourceText);
    form.append("request", request);
    form.append("imageModel", selectedModel);
    try {
      const response = await fetch("/api/generate", { method: "POST", body: form });
      const generated = await readPackageResponse(response, "教材を生成できませんでした。");
      const next = generated.package;
      const nextImages = await renderImages(next, selectedModel, generated.renderGrant);
      setResult(next);
      setImages(nextImages);
      void savePersonalPackage(next, nextImages).catch(() => undefined);
      setImageModel(null);
      setSlideIndex(0);
      setStep("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "教材を生成できませんでした。");
      setStep("input");
    }
  };
  const revise = async () => {
    if (!result || revision.trim().length < 3) return;
    if (!imageModel) {
      setError("修正版に使う画像生成モデルを選択してください。");
      return;
    }
    const selectedModel = imageModel;
    const current = result;
    const currentImages = images;
    setError("");
    setStep("generating");
    try {
      const response = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: result, request: revision, imageModel: selectedModel }),
      });
      const revised = await readPackageResponse(response, "教材を修正できませんでした。");
      const next = revised.package;
      const nextImages = await renderImages(next, selectedModel, revised.renderGrant, current, currentImages);
      setResult(next);
      setImages(nextImages);
      void savePersonalPackage(next, nextImages).catch(() => undefined);
      setImageModel(null);
      setRevision("");
      setSlideIndex(0);
      setStep("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "教材を修正できませんでした。");
      setStep("complete");
    }
  };
  const download = async () => {
    if (!result) return;
    try {
      const blob = await createTeachingPackageZip(result, images, await createMontagePng(images));
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "kyozai-teaching-package.zip";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "納品ZIPを作成できませんでした。");
    }
  };
  return (
    <main className="app-shell">
      <AppHeader menuOpen={menuOpen} onMenu={() => setMenuOpen((value) => !value)} />
      {menuOpen && <div className="mobile-menu"><button onClick={() => setMenuOpen(false)}>教材を作る</button><button disabled>履歴 <DevBadge /></button><button disabled>テンプレート <DevBadge /></button></div>}
      <div className="beta-strip"><span>公開体験版</span> 中核機能は実際に動作します。入力資料と生成指示は選択したAI APIへ送信され、KYOZAIのサーバーには保存しません。</div>
      {step === "input" && (
        <InputView
          files={files}
          sourceUrl={sourceUrl}
          sourceText={sourceText}
          request={request}
          imageModel={imageModel}
          error={error}
          onFiles={onFiles}
          setSourceUrl={setSourceUrl}
          setSourceText={setSourceText}
          setRequest={setRequest}
          setImageModel={setImageModel}
          generate={generate}
        />
      )}
      {step === "generating" && <GeneratingView isRevision={Boolean(result)} files={files} sourceUrl={sourceUrl} progress={progress} />}
      {step === "complete" && result && (
        <CompleteView
          result={result}
          images={images}
          imageModel={imageModel}
          tab={tab}
          slideIndex={slideIndex}
          revision={revision}
          error={error}
          setTab={setTab}
          setSlideIndex={setSlideIndex}
          setRevision={setRevision}
          setImageModel={setImageModel}
          revise={revise}
          download={download}
          restart={() => { void clearPersonalPackage().catch(() => undefined); setResult(null); setImages([]); setImageModel(null); setStep("input"); setError(""); }}
        />
      )}
    </main>
  );
}
type InputProps = {
  files: File[]; sourceUrl: string; sourceText: string; request: string; error: string; imageModel: ImageModelId | null; onFiles: (files: FileList | null) => void;
  setSourceUrl: (value: string) => void; setSourceText: (value: string) => void; setRequest: (value: string) => void; setImageModel: (value: ImageModelId) => void; generate: () => void;
};
function InputView(props: InputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="workspace" id="create">
      <div className="intro">
        <p className="eyebrow"><Sparkles size={16} /> AI教材生成</p>
        <h1>{HOME_HEADING}</h1>
        <p>手元の資料をもとに、スライド構成・講師シナリオ・FAQ・確認テストをまとめて作成します。</p>
      </div>
      <div className="input-layout">
        <div className="source-panel">
          <div className="section-heading"><span>1</span><div><h2>もとになる資料を追加</h2><p>資料の内容だけを根拠に教材を作成します</p></div></div>
          <button
            className="dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); props.onFiles(event.dataTransfer.files); }}
          >
            <UploadCloud size={34} />
            <strong>ファイルを選択またはドロップ</strong>
            <span>PDF・TXT・Markdown / 1ファイル2MBまで / 最大2件</span>
          </button>
          <input ref={inputRef} className="sr-only" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" multiple onChange={(event) => props.onFiles(event.target.files)} />
          {props.files.length > 0 && <div className="file-list">{props.files.map((file) => <div key={file.name}><FileText size={18} /><span>{file.name}</span><small>{(file.size / 1024).toFixed(0)} KB</small></div>)}</div>}
          <div className="divider"><span>または</span></div>
          <label className="field-label" htmlFor="source-url"><Link2 size={17} /> 公開URL</label>
          <input id="source-url" type="url" value={props.sourceUrl} onChange={(event) => props.setSourceUrl(event.target.value)} placeholder="https://example.com/article" />
          <label className="field-label" htmlFor="source-text"><FileText size={17} /> テキストを直接入力</label>
          <textarea id="source-text" className="source-text" value={props.sourceText} onChange={(event) => props.setSourceText(event.target.value)} placeholder="研修の元になる文章やメモを貼り付けてください" maxLength={80000} />
          <div className="future-formats"><span>PowerPoint</span><DevBadge /><span>Word</span><DevBadge /></div>
        </div>
        <div className="request-panel">
          <div className="section-heading"><span>2</span><div><h2>どんな教材にしますか？</h2><p>対象・時間・伝え方を自然な言葉で指定</p></div></div>
          <textarea value={props.request} onChange={(event) => props.setRequest(event.target.value)} maxLength={1000} aria-label="教材への要望" />
          <div className="suggestions">
            <button onClick={() => props.setRequest("新入社員向けの30分研修。初心者にもわかる表現で、具体例を入れてください。")}>新入社員向け</button>
            <button onClick={() => props.setRequest("現場リーダー向けの45分研修。ケーススタディと判断基準を重視してください。")}>現場リーダー向け</button>
            <button onClick={() => props.setRequest("15分で要点を理解できる短縮版。専門用語には説明を添えてください。")}>15分の短縮版</button>
          </div>
          <div className="package-list">
            <p><Check /> スライド構成</p><p><Check /> 講師シナリオ</p><p><Check /> FAQ</p><p><Check /> 確認テスト</p>
          </div>
          <ImageModelPicker value={props.imageModel} onChange={props.setImageModel} />
          {props.error && <p className="error-message" role="alert">{props.error}</p>}
          <button className="primary-action" onClick={props.generate} disabled={!props.imageModel}><Sparkles size={20} /> 教材を作ってもらう</button>
          <p className="privacy-note">入力と生成結果はこの画面内だけで保持し、KYOZAIのサーバーには保存しません。OpenAIまたはGemini APIへ送信するため、機密情報・個人情報は入力しないでください。</p>
        </div>
      </div>
    </section>
  );
}
type CompleteProps = {
  result: TeachingPackage; images: RenderedSlideImage[]; imageModel: ImageModelId | null; tab: Tab; slideIndex: number; revision: string; error: string;
  setTab: (tab: Tab) => void; setSlideIndex: React.Dispatch<React.SetStateAction<number>>; setRevision: (value: string) => void;
  setImageModel: (value: ImageModelId) => void; revise: () => void; download: () => Promise<void>; restart: () => void;
};
function CompleteView(props: CompleteProps) {
  const { result } = props;
  return (
    <section className="complete-view">
      <div className="complete-heading"><span className="success-icon"><Check /></span><div><p className="eyebrow">教材が完成しました</p><h1>{result.title}</h1><p>{result.sourceSummary}</p></div><button className="secondary-action" onClick={props.restart}>別の教材を作る</button></div>
      <div className="project-facts"><span><Clock3 /> {result.durationMinutes}分</span><span><Users /> {result.targetAudience}</span><span><Presentation /> {result.slides.length}スライド</span></div>
      <div className="result-tabs" role="tablist">
        <button className={props.tab === "slides" ? "active" : ""} onClick={() => props.setTab("slides")}><Presentation /> スライド</button>
        <button className={props.tab === "scenario" ? "active" : ""} onClick={() => props.setTab("scenario")}><BookOpenText /> 講師シナリオ</button>
        <button className={props.tab === "faq" ? "active" : ""} onClick={() => props.setTab("faq")}><MessageSquareText /> FAQ</button>
        <button className={props.tab === "quiz" ? "active" : ""} onClick={() => props.setTab("quiz")}><Check /> 確認テスト</button>
      </div>
      <div className="result-content">
        {props.tab === "slides" && <SlidePreview result={result} images={props.images} index={props.slideIndex} setIndex={props.setSlideIndex} />}
        {props.tab === "scenario" && <div className="document-list">{result.scenario.map((item) => <article key={item.section}><span>{item.minutes}分</span><div><h3>{item.section}</h3><p>{item.guidance}</p></div></article>)}</div>}
        {props.tab === "faq" && <div className="document-list">{result.faq.map((item, index) => <article key={item.question}><span>Q{index + 1}</span><div><h3>{item.question}</h3><p>{item.answer}</p></div></article>)}</div>}
        {props.tab === "quiz" && <div className="document-list quiz-list">{result.quiz.map((item, index) => <article key={item.question}><span>{index + 1}</span><div><h3>{item.question}</h3>{item.options.map((option, optionIndex) => <p key={option} className={optionIndex === item.answerIndex ? "correct" : ""}>{optionIndex === item.answerIndex && <Check size={15} />} {option}</p>)}<small>{item.explanation}</small></div></article>)}</div>}
      </div>
      <div className="result-actions"><button className="primary-action" onClick={() => void props.download()}><Download /> 完成PNG・台本・検証ZIPを取得</button><span>PPTX書き出し <DevBadge /></span></div>
      <div className="revision-panel">
        <div><Sparkles /><span><strong>AIに修正を頼む</strong><small>対象箇所を探す必要はありません。教材全体の整合を保って直します。</small></span></div>
        <div className="revision-input"><input value={props.revision} onChange={(event) => props.setRevision(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && props.imageModel) props.revise(); }} placeholder="例：もっと初心者向けに。具体例を増やして、専門用語をやさしくして" maxLength={600} /><button className="icon-button send-button" onClick={props.revise} disabled={props.revision.trim().length < 3 || !props.imageModel} title="修正を依頼"><Send /><span className="sr-only">修正を依頼</span></button></div>
        <div className="suggestions"><button onClick={() => props.setRevision("もっと初心者向けの表現にしてください")}>初心者向けに</button><button onClick={() => props.setRevision("具体例を増やしてください")}>具体例を増やす</button><button onClick={() => props.setRevision("15分で実施できる短縮版にしてください")}>15分版にする</button></div>
        <ImageModelPicker value={props.imageModel} onChange={props.setImageModel} />
        {props.error && <p className="error-message" role="alert">{props.error}</p>}
      </div>
    </section>
  );
}
