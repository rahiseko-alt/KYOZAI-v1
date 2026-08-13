"use client";

import Image from "next/image";
import {
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  Link2,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Presentation,
  Send,
  Sparkles,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { HOME_HEADING } from "@/lib/content";
import { readPackageResponse } from "@/lib/kyozai/api-client";
import { formatDuration, slideDurationSeconds } from "@/lib/kyozai/design";
import { packageHtml } from "@/lib/kyozai/package-html";
import type { TeachingPackage } from "@/lib/kyozai/types";
import { SlideArtwork } from "./slide-artwork";

type Step = "input" | "generating" | "complete";
type Tab = "slides" | "scenario" | "faq" | "quiz";

const processingItems = ["資料の読み取り", "学習構成の設計", "4成果物の生成", "構造と整合の検証"];

export function Workspace() {
  const [step, setStep] = useState<Step>("input");
  const [files, setFiles] = useState<File[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [request, setRequest] = useState("新入社員向けの30分研修。初心者にもわかる表現で、具体例を入れてください。");
  const [result, setResult] = useState<TeachingPackage | null>(null);
  const [tab, setTab] = useState<Tab>("slides");
  const [slideIndex, setSlideIndex] = useState(0);
  const [revision, setRevision] = useState("");
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const onFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted = Array.from(incoming).filter((file) => ["application/pdf", "text/plain", "text/markdown"].includes(file.type) || /\.(txt|md)$/i.test(file.name));
    setFiles(accepted.slice(0, 2));
    if (accepted.length !== incoming.length) setError("体験版はPDF・TXT・Markdownに対応しています。PowerPoint・Wordは開発中です。");
    else setError("");
  };

  const generate = async () => {
    if (!files.length && !sourceText.trim() && !sourceUrl.trim()) {
      setError("資料、URL、またはテキストを1つ以上追加してください。");
      return;
    }
    setError("");
    setStep("generating");
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.append("sourceUrl", sourceUrl);
    form.append("sourceText", sourceText);
    form.append("request", request);
    try {
      const response = await fetch("/api/generate", { method: "POST", body: form });
      setResult(await readPackageResponse(response, "教材を生成できませんでした。"));
      setSlideIndex(0);
      setStep("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "教材を生成できませんでした。");
      setStep("input");
    }
  };

  const revise = async () => {
    if (!result || revision.trim().length < 3) return;
    setError("");
    setStep("generating");
    try {
      const response = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: result, request: revision }),
      });
      setResult(await readPackageResponse(response, "教材を修正できませんでした。"));
      setRevision("");
      setSlideIndex(0);
      setStep("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "教材を修正できませんでした。");
      setStep("complete");
    }
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([packageHtml(result)], { type: "text/html;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "kyozai-teaching-package.html";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <main className="app-shell">
      <Header menuOpen={menuOpen} onMenu={() => setMenuOpen((value) => !value)} />
      {menuOpen && <div className="mobile-menu"><button onClick={() => setMenuOpen(false)}>教材を作る</button><button disabled>履歴 <DevBadge /></button><button disabled>テンプレート <DevBadge /></button></div>}
      <div className="beta-strip"><span>公開体験版</span> 中核機能は実際に動作します。入力資料はOpenAI APIへ送信され、KYOZAIのサーバーには保存しません。</div>
      {step === "input" && (
        <InputView
          files={files}
          sourceUrl={sourceUrl}
          sourceText={sourceText}
          request={request}
          error={error}
          onFiles={onFiles}
          setSourceUrl={setSourceUrl}
          setSourceText={setSourceText}
          setRequest={setRequest}
          generate={generate}
        />
      )}
      {step === "generating" && <GeneratingView isRevision={Boolean(result)} files={files} sourceUrl={sourceUrl} />}
      {step === "complete" && result && (
        <CompleteView
          result={result}
          tab={tab}
          slideIndex={slideIndex}
          revision={revision}
          error={error}
          setTab={setTab}
          setSlideIndex={setSlideIndex}
          setRevision={setRevision}
          revise={revise}
          download={download}
          restart={() => { setResult(null); setStep("input"); setError(""); }}
        />
      )}
    </main>
  );
}

function Header({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  return (
    <header className="topbar">
      <a className="brand" href="#top" aria-label="KYOZAI ホーム">
        <Image src="/brand/kyozai-logo.jpg" alt="KYOZAI 資料を、教えられる教材へ。" width={485} height={197} priority />
      </a>
      <nav aria-label="メインナビゲーション">
        <a className="active" href="#create">教材を作る</a>
        <button disabled>履歴 <DevBadge /></button>
        <button disabled>テンプレート <DevBadge /></button>
      </nav>
      <div className="top-actions"><button className="icon-button" title="ヘルプ（開発中）" disabled><CircleHelp size={20} /><span className="sr-only">ヘルプ（開発中）</span></button><span className="trial-label">TRIAL</span></div>
      <button className="menu-button icon-button" onClick={onMenu} aria-expanded={menuOpen} aria-label="メニューを開く">{menuOpen ? <X /> : <Menu />}</button>
    </header>
  );
}

function DevBadge() { return <span className="dev-badge">開発中</span>; }

type InputProps = {
  files: File[]; sourceUrl: string; sourceText: string; request: string; error: string;
  onFiles: (files: FileList | null) => void;
  setSourceUrl: (value: string) => void; setSourceText: (value: string) => void; setRequest: (value: string) => void; generate: () => void;
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
            <span>PDF・TXT・Markdown / 1ファイル8MBまで / 最大2件</span>
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
          {props.error && <p className="error-message" role="alert">{props.error}</p>}
          <button className="primary-action" onClick={props.generate}><Sparkles size={20} /> 教材を作ってもらう</button>
          <p className="privacy-note">入力と生成結果はこの画面内だけで保持し、KYOZAIのサーバーには保存しません。OpenAI APIへ送信するため、機密情報・個人情報は入力しないでください。</p>
        </div>
      </div>
    </section>
  );
}

function GeneratingView({ isRevision, files, sourceUrl }: { isRevision: boolean; files: File[]; sourceUrl: string }) {
  return (
    <section className="generating-view" aria-live="polite">
      <div className="generating-mark"><LoaderCircle className="spin" /><Sparkles /></div>
          <p className="eyebrow">KYOZAI AI</p>
      <h1>{isRevision ? "修正内容を教材全体へ反映しています" : "教えられる教材へ変換しています"}</h1>
      <p>この画面を開いたままお待ちください。通常1〜2分ほどかかります。</p>
      <div className="processing-bar"><span /></div>
      <ul className="processing-items">{processingItems.map((item) => <li key={item}><Check size={15} /> {item}</li>)}</ul>
      <p className="processing-truth">工程別の完了表示は行わず、サーバーから検証済みの教材が返った時点でのみ完成画面へ進みます。</p>
      <div className="source-summary"><FileText size={19} /><span>{files.length ? `${files.length}件のファイル` : sourceUrl ? "公開URL" : "入力テキスト"}</span><span>を根拠に生成中</span></div>
    </section>
  );
}

type CompleteProps = {
  result: TeachingPackage; tab: Tab; slideIndex: number; revision: string; error: string;
  setTab: (tab: Tab) => void; setSlideIndex: React.Dispatch<React.SetStateAction<number>>; setRevision: (value: string) => void;
  revise: () => void; download: () => void; restart: () => void;
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
        {props.tab === "slides" && <SlidePreview result={result} index={props.slideIndex} setIndex={props.setSlideIndex} />}
        {props.tab === "scenario" && <div className="document-list">{result.scenario.map((item) => <article key={item.section}><span>{item.minutes}分</span><div><h3>{item.section}</h3><p>{item.guidance}</p></div></article>)}</div>}
        {props.tab === "faq" && <div className="document-list">{result.faq.map((item, index) => <article key={item.question}><span>Q{index + 1}</span><div><h3>{item.question}</h3><p>{item.answer}</p></div></article>)}</div>}
        {props.tab === "quiz" && <div className="document-list quiz-list">{result.quiz.map((item, index) => <article key={item.question}><span>{index + 1}</span><div><h3>{item.question}</h3>{item.options.map((option, optionIndex) => <p key={option} className={optionIndex === item.answerIndex ? "correct" : ""}>{optionIndex === item.answerIndex && <Check size={15} />} {option}</p>)}<small>{item.explanation}</small></div></article>)}</div>}
      </div>
      <div className="result-actions"><button className="primary-action" onClick={props.download}><Download /> 印刷できるHTML教材を取得</button><span>PPTX書き出し <DevBadge /></span></div>
      <div className="revision-panel">
        <div><Sparkles /><span><strong>AIに修正を頼む</strong><small>対象箇所を探す必要はありません。教材全体の整合を保って直します。</small></span></div>
        <div className="revision-input"><input value={props.revision} onChange={(event) => props.setRevision(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.revise(); }} placeholder="例：もっと初心者向けに。具体例を増やして、専門用語をやさしくして" maxLength={600} /><button className="icon-button send-button" onClick={props.revise} disabled={props.revision.trim().length < 3} title="修正を依頼"><Send /><span className="sr-only">修正を依頼</span></button></div>
        <div className="suggestions"><button onClick={() => props.setRevision("もっと初心者向けの表現にしてください")}>初心者向けに</button><button onClick={() => props.setRevision("具体例を増やしてください")}>具体例を増やす</button><button onClick={() => props.setRevision("15分で実施できる短縮版にしてください")}>15分版にする</button></div>
        {props.error && <p className="error-message" role="alert">{props.error}</p>}
      </div>
    </section>
  );
}

function SlidePreview({ result, index, setIndex }: { result: TeachingPackage; index: number; setIndex: React.Dispatch<React.SetStateAction<number>> }) {
  const slide = result.slides[index];
  if (!slide) return null;
  const duration = slideDurationSeconds(slide);
  return (
    <div className="slide-layout">
      <SlideArtwork slide={slide} total={result.slides.length} />
      <aside className="speaker-notes"><div><p>講師ノート</p><span>{slide.speakerNotes.length}字 / {formatDuration(duration)}</span></div><h3>{slide.title}</h3><p>{slide.speakerNotes}</p></aside>
      <div className="slide-controls"><button className="icon-button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} title="前のスライド"><ChevronLeft /><span className="sr-only">前のスライド</span></button><span>{index + 1} / {result.slides.length}</span><button className="icon-button" onClick={() => setIndex((value) => Math.min(result.slides.length - 1, value + 1))} disabled={index === result.slides.length - 1} title="次のスライド"><ChevronRight /><span className="sr-only">次のスライド</span></button></div>
    </div>
  );
}
