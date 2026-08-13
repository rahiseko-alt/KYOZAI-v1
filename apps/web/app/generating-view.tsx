import { Check, FileText, LoaderCircle, Sparkles } from "lucide-react";

export type GenerationProgress = { phase: "content" | "images"; completed: number; total: number };

const processingItems = ["資料の読み取り", "学習構成の設計", "4成果物の生成", "構造と整合の検証"];

export function GeneratingView({ isRevision, files, sourceUrl, progress }: { isRevision: boolean; files: File[]; sourceUrl: string; progress: GenerationProgress }) {
  const status = progress.phase === "images"
    ? `完成画像を1枚ずつ生成・検証中 ${progress.completed} / ${progress.total}`
    : "教材内容を設計し、画像生成前の内容を確定しています";
  return (
    <section className="generating-view" aria-live="polite">
      <div className="generating-mark"><LoaderCircle className="spin" /><Sparkles /></div>
      <p className="eyebrow">KYOZAI AI</p>
      <h1>{isRevision ? "修正内容を教材全体へ反映しています" : "教えられる教材へ変換しています"}</h1>
      <p>{status}</p>
      <div className="processing-bar"><span /></div>
      <ul className="processing-items">{processingItems.map((item) => <li key={item}><Check size={15} /> {item}</li>)}</ul>
      <p className="processing-truth">内容確定後に各ページを別々に画像化し、実画像QAへ合格した完成PNGが全枚揃った時点だけ完成画面へ進みます。</p>
      <div className="source-summary"><FileText size={19} /><span>{files.length ? `${files.length}件のファイル` : sourceUrl ? "公開URL" : "入力テキスト"}</span><span>を根拠に生成中</span></div>
    </section>
  );
}
