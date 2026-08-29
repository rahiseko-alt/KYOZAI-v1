"use client";

import { Check, FileText, Link2, Sparkles, UploadCloud } from "lucide-react";
import { useRef } from "react";

import { HOME_HEADING } from "../lib/content";
import type { ImageModelId } from "../lib/kyozai/image-models";
import { DevBadge } from "./app-header";
import { ImageModelPicker } from "./image-model-picker";

type InputProps = {
  files: File[]; sourceUrl: string; sourceText: string; request: string; error: string; imageModel: ImageModelId | null; onFiles: (files: FileList | null) => void;
  setSourceUrl: (value: string) => void; setSourceText: (value: string) => void; setRequest: (value: string) => void; setImageModel: (value: ImageModelId) => void; generate: () => void;
};

export function InputView(props: InputProps) {
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
          <button className="dropzone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); props.onFiles(event.dataTransfer.files); }}>
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
          <div className="package-list"><p><Check /> スライド構成</p><p><Check /> 講師シナリオ</p><p><Check /> FAQ</p><p><Check /> 確認テスト</p></div>
          <ImageModelPicker value={props.imageModel} onChange={props.setImageModel} />
          {props.error && <p className="error-message" role="alert">{props.error}</p>}
          <button className="primary-action" onClick={props.generate} disabled={!props.imageModel}><Sparkles size={20} /> 教材を作ってもらう</button>
          <p className="privacy-note">入力と生成結果はこの画面内だけで保持し、KYOZAIのサーバーには保存しません。OpenAIまたはGemini APIへ送信するため、機密情報・個人情報は入力しないでください。</p>
        </div>
      </div>
    </section>
  );
}
