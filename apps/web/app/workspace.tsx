"use client";

import Image from "next/image";
import {
  Check,
  CircleHelp,
  FileText,
  Link2,
  LoaderCircle,
  Menu,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { HOME_HEADING } from "@/lib/content";
import { readPackageResponse, readRevisionResponse } from "@/lib/kyozai/api-client";
import { packageHtml } from "@/lib/kyozai/package-html";
import type { RevisionMetadata } from "@/lib/kyozai/revision";
import { canPromoteRevision, EMPTY_VERSION_STATE, initialVersion, moveVersion as moveVersionIndex, promoteRevision, type VersionState } from "@/lib/kyozai/version-history";
import { CompleteView, type CompleteTab } from "./complete-view";
import { DevBadge } from "./dev-badge";

type Step = "input" | "generating" | "complete";

const processingItems = ["資料の読み取り", "学習構成の設計", "4成果物の生成", "構造と整合の検証"];

export function Workspace() {
  const [step, setStep] = useState<Step>("input");
  const [files, setFiles] = useState<File[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [request, setRequest] = useState("新入社員向けの30分研修。初心者にもわかる表現で、具体例を入れてください。");
  const [versions, setVersions] = useState<VersionState>(EMPTY_VERSION_STATE);
  const versionsRef = useRef<VersionState>(EMPTY_VERSION_STATE);
  const [tab, setTab] = useState<CompleteTab>("slides");
  const [slideIndex, setSlideIndex] = useState(0);
  const [revision, setRevision] = useState("");
  const [error, setError] = useState("");
  const [revisionPending, setRevisionPending] = useState(false);
  const [revisionSummary, setRevisionSummary] = useState<RevisionMetadata | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const revisionAbortRef = useRef<AbortController | null>(null);
  const revisionSequenceRef = useRef(0);
  const result = versions.entries[versions.index]?.package ?? null;

  const updateVersions = (updater: (current: VersionState) => VersionState) => {
    setVersions((current) => {
      const next = updater(current);
      versionsRef.current = next;
      return next;
    });
  };

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
      const packageValue = await readPackageResponse(response, "教材を生成できませんでした。");
      updateVersions(() => initialVersion(packageValue));
      setSlideIndex(0);
      setRevisionSummary(null);
      setStep("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "教材を生成できませんでした。");
      setStep("input");
    }
  };

  const revise = async () => {
    const baseState = versionsRef.current;
    const baseEntry = baseState.entries[baseState.index];
    if (!baseEntry || revision.trim().length < 3 || revisionPending) return;
    const baseIndex = baseState.index;
    const sequence = revisionSequenceRef.current + 1;
    revisionSequenceRef.current = sequence;
    revisionAbortRef.current?.abort();
    const controller = new AbortController();
    revisionAbortRef.current = controller;
    setError("");
    setRevisionSummary(null);
    setRevisionPending(true);
    try {
      const response = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package: baseEntry.package,
          request: revision,
          selectedSlideNumber: slideIndex + 1,
          baseVersionId: baseEntry.id,
        }),
        signal: controller.signal,
      });
      const payload = await readRevisionResponse(response, "教材を修正できませんでした。元の教材は維持されています。");
      const latest = versionsRef.current;
      const latestBase = latest.entries[latest.index];
      const stale = controller.signal.aborted || sequence !== revisionSequenceRef.current || !latestBase || !canPromoteRevision(latest, baseIndex, baseEntry.id, payload.package, payload.revision);
      if (stale) return;
      updateVersions((current) => promoteRevision(current, baseIndex, payload.package, payload.revision));
      setRevision("");
      setRevisionSummary(payload.revision);
    } catch (caught) {
      if (controller.signal.aborted || sequence !== revisionSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : "教材を修正できませんでした。");
    } finally {
      if (sequence === revisionSequenceRef.current) setRevisionPending(false);
    }
  };

  const cancelRevision = () => {
    revisionSequenceRef.current += 1;
    revisionAbortRef.current?.abort();
    setRevisionPending(false);
    setError("修正を取り消しました。元の教材を表示しています。");
  };

  const moveVersion = (offset: -1 | 1) => {
    revisionSequenceRef.current += 1;
    revisionAbortRef.current?.abort();
    setRevisionPending(false);
    setRevisionSummary(null);
    setError("");
    updateVersions((current) => moveVersionIndex(current, offset));
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
          revisionPending={revisionPending}
          revisionSummary={revisionSummary}
          cancelRevision={cancelRevision}
          canUndo={versions.index > 0}
          canRedo={versions.index >= 0 && versions.index < versions.entries.length - 1}
          undo={() => moveVersion(-1)}
          redo={() => moveVersion(1)}
          download={download}
          restart={() => { revisionSequenceRef.current += 1; revisionAbortRef.current?.abort(); updateVersions(() => EMPTY_VERSION_STATE); setStep("input"); setError(""); setRevisionSummary(null); }}
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
