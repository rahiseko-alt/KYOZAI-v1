"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, FileText, Link2, LogOut, Mail, Sparkles, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { HOME_HEADING } from "../lib/content";
import type { ImageModelId } from "../lib/kyozai/image-models";
import { createBrowserSupabaseClient } from "../lib/supabase/browser";
import { AppHeader } from "./app-header";
import { ImageModelPicker } from "./image-model-picker";

const MAX_UPLOADS = 2;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const allowedFile = (file: File) => ["application/pdf", "text/plain", "text/markdown"].includes(file.type) || /\.(pdf|txt|md|markdown)$/i.test(file.name);

type PendingUpload = { attachmentId: string; uploadUrl: string; file: File };

function errorMessage(response: Response, fallback: string) {
  return response.json().then((body: unknown) => {
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
    return fallback;
  }).catch(() => fallback);
}

function idempotencyKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The only non-production creation route. It never sends a package or base64 image through the browser. */
export function AsyncJobWorkspace() {
  const clientRef = useRef<SupabaseClient | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authNotice, setAuthNotice] = useState<string>();
  const [files, setFiles] = useState<File[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [request, setRequest] = useState("新入社員向けの30分研修。初心者にもわかる表現で、具体例を入れてください。");
  const [imageModel, setImageModel] = useState<ImageModelId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const client = useCallback(() => {
    if (!clientRef.current) clientRef.current = createBrowserSupabaseClient();
    return clientRef.current;
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void Promise.resolve().then(client).then((supabase) => {
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        setSignedIn(Boolean(session));
        setSessionReady(true);
      });
      unsubscribe = () => subscription.subscription.unsubscribe();
      return supabase.auth.getSession();
    }).then((result) => {
      if (!result || !active) return;
      const { data, error: sessionError } = result;
      if (sessionError) setError("ログイン状態を確認できませんでした。設定を確認してください。");
      setSignedIn(Boolean(data.session));
      setSessionReady(true);
    }).catch(() => {
      if (!active) return;
      setError("認証の設定を確認できませんでした。");
      setSessionReady(true);
    });
    return () => { active = false; unsubscribe?.(); };
  }, [client]);

  const accessToken = useCallback(async () => {
    const { data, error: sessionError } = await client().auth.getSession();
    if (sessionError || !data.session?.access_token) throw new Error("ログインしてください。");
    return data.session.access_token;
  }, [client]);

  const onFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const candidate = Array.from(incoming);
    const total = candidate.reduce((sum, file) => sum + file.size, 0);
    if (candidate.length > MAX_UPLOADS || total > MAX_UPLOAD_BYTES || candidate.some((file) => !allowedFile(file))) {
      setError("PDF・TXT・Markdownを最大2件、合計25MiBまで追加できます。");
      return;
    }
    setFiles(candidate);
    setError(undefined);
  };

  const signIn = async () => {
    if (!email.trim()) { setAuthNotice("メールアドレスを入力してください。"); return; }
    setAuthNotice(undefined);
    try {
      const { error: otpError } = await client().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (otpError) throw otpError;
      setAuthNotice("確認メールを送信しました。メール内のリンクを開くと、この画面へ戻ります。");
    } catch {
      setAuthNotice("確認メールを送信できませんでした。時間を置いてもう一度お試しください。");
    }
  };

  const signOut = async () => {
    await client().auth.signOut();
    setFiles([]);
    setError(undefined);
  };

  const prepareUploads = async (token: string): Promise<PendingUpload[]> => {
    const uploads: PendingUpload[] = [];
    for (const file of files) {
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: file.name, mediaType: file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "text/plain"), byteSize: file.size }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "アップロードを準備できませんでした。"));
      const data = await response.json() as { attachmentId: string; uploadUrl: string };
      uploads.push({ ...data, file });
    }
    for (const upload of uploads) {
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": upload.file.type || "application/octet-stream" },
        body: upload.file,
      });
      if (!response.ok) throw new Error("ファイルを保存できませんでした。もう一度お試しください。");
    }
    return uploads;
  };

  const createJob = async () => {
    if (!signedIn) { setError("確認済みメールアドレスでログインしてください。"); return; }
    if (!files.length && !sourceText.trim() && !sourceUrl.trim()) { setError("資料、URL、またはテキストを1つ以上追加してください。"); return; }
    if (!imageModel) { setError("画像生成モデルを選択してください。"); return; }
    setBusy(true);
    setError(undefined);
    try {
      const token = await accessToken();
      const uploads = await prepareUploads(token);
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": idempotencyKey(),
        },
        body: JSON.stringify({ request, imageModel, sourceText: sourceText.trim() || undefined, sourceUrl: sourceUrl.trim() || undefined, attachmentIds: uploads.map((upload) => upload.attachmentId) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "教材jobを受け付けできませんでした。"));
      const data = await response.json() as { jobId: string };
      window.location.assign(`/jobs/${encodeURIComponent(data.jobId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "教材jobを受け付けできませんでした。");
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <AppHeader menuOpen={false} onMenu={() => undefined} />
      <div className="beta-strip"><span>認証済み検証環境</span>jobはサーバー側で安全に継続します。画面を閉じても生成は止まりません。</div>
      <section className="workspace" id="create">
        <div className="intro"><p className="eyebrow"><Sparkles size={16} /> AI教材生成</p><h1>{HOME_HEADING}</h1><p>資料を安全に保存し、工程ごとの検証を通過した成果物だけを納品します。</p></div>
        {!sessionReady ? <p>ログイン状態を確認しています。</p> : !signedIn ? (
          <section className="auth-panel" aria-labelledby="login-heading"><Mail size={22} /><div><h2 id="login-heading">検証環境へログイン</h2><p>確認済みのメールアドレスだけが教材jobを作成できます。</p></div><label htmlFor="email">メールアドレス</label><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /><button type="button" className="primary-action" onClick={() => void signIn()}>確認メールを送信</button>{authNotice ? <p role="status">{authNotice}</p> : null}</section>
        ) : (
          <div className="input-layout">
            <div className="source-panel"><div className="section-heading"><span>1</span><div><h2>もとになる資料を追加</h2><p>資料の内容だけを根拠に教材を作成します</p></div></div>
              <button type="button" className="dropzone" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onFiles(event.dataTransfer.files); }}><UploadCloud size={34} /><strong>ファイルを選択またはドロップ</strong><span>PDF・TXT・Markdown / 合計25MiBまで / 最大2件</span></button>
              <input ref={fileInputRef} className="sr-only" type="file" accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" multiple onChange={(event) => onFiles(event.target.files)} />
              {files.length > 0 ? <div className="file-list">{files.map((file) => <div key={`${file.name}-${file.lastModified}`}><FileText size={18} /><span>{file.name}</span><small>{(file.size / 1024).toFixed(0)} KB</small></div>)}</div> : null}
              <div className="divider"><span>または</span></div><label className="field-label" htmlFor="source-url"><Link2 size={17} /> 公開URL</label><input id="source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/article" />
              <label className="field-label" htmlFor="source-text"><FileText size={17} /> テキストを直接入力</label><textarea id="source-text" className="source-text" value={sourceText} onChange={(event) => setSourceText(event.target.value)} maxLength={80000} placeholder="研修の元になる文章やメモを貼り付けてください" />
            </div>
            <div className="request-panel"><div className="section-heading"><span>2</span><div><h2>どんな教材にしますか？</h2><p>対象・時間・伝え方を自然な言葉で指定</p></div></div><textarea value={request} onChange={(event) => setRequest(event.target.value)} maxLength={1000} aria-label="教材への要望" /><div className="package-list"><p><Check /> スライド構成</p><p><Check /> 講師シナリオ</p><p><Check /> FAQ</p><p><Check /> 確認テスト</p></div><ImageModelPicker value={imageModel} onChange={setImageModel} />{error ? <p className="error-message" role="alert">{error}</p> : null}<button type="button" className="primary-action" onClick={() => void createJob()} disabled={busy || !imageModel}>{busy ? "資料を保存しています…" : "教材jobを開始"}</button><button type="button" className="text-action" onClick={() => void signOut()}><LogOut size={15} /> ログアウト</button><p className="privacy-note">入力資料と成果物は認証済みの利用者だけが取得できます。機密情報・個人情報は入力しないでください。</p></div>
          </div>
        )}
      </section>
    </main>
  );
}
