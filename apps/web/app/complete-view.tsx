import { BookOpenText, Check, ChevronLeft, ChevronRight, Clock3, Download, LoaderCircle, MessageSquareText, Presentation, Redo2, Send, Sparkles, Square, Undo2, Users } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { formatDuration, slideDurationSeconds } from "@/lib/kyozai/design";
import type { RevisionMetadata } from "@/lib/kyozai/revision";
import type { TeachingPackage } from "@/lib/kyozai/types";
import { DevBadge } from "./dev-badge";
import { SlideArtwork } from "./slide-artwork";

export type CompleteTab = "slides" | "scenario" | "faq" | "quiz";

type CompleteProps = {
  result: TeachingPackage; tab: CompleteTab; slideIndex: number; revision: string; error: string;
  setTab: (tab: CompleteTab) => void; setSlideIndex: Dispatch<SetStateAction<number>>; setRevision: (value: string) => void;
  revise: () => void; revisionPending: boolean; revisionSummary: RevisionMetadata | null; cancelRevision: () => void;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; download: () => void; restart: () => void;
};

export function CompleteView(props: CompleteProps) {
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
      <RevisionPanel {...props} />
    </section>
  );
}

function RevisionPanel(props: CompleteProps) {
  return (
    <div className="revision-panel">
      <div className="revision-heading"><Sparkles /><span><strong>表示中のスライドをAIで修正</strong><small>検証に合格した文言だけを反映します。</small></span><div className="version-controls"><button className="icon-button" onClick={props.undo} disabled={!props.canUndo || props.revisionPending} title="前の版へ戻す"><Undo2 /><span className="sr-only">前の版へ戻す</span></button><button className="icon-button" onClick={props.redo} disabled={!props.canRedo || props.revisionPending} title="次の版へ進む"><Redo2 /><span className="sr-only">次の版へ進む</span></button></div></div>
      <div className="revision-input"><input value={props.revision} onChange={(event) => props.setRevision(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !props.revisionPending) props.revise(); }} placeholder="例：このスライドの見出しを短くしてください" maxLength={600} disabled={props.revisionPending} />{props.revisionPending ? <button className="icon-button cancel-button" onClick={props.cancelRevision} title="修正を中止"><Square /><span className="sr-only">修正を中止</span></button> : <button className="icon-button send-button" onClick={props.revise} disabled={props.revision.trim().length < 3} title="修正を依頼"><Send /><span className="sr-only">修正を依頼</span></button>}</div>
      <div className="suggestions"><button disabled={props.revisionPending} onClick={() => props.setRevision("このスライドの見出しを短くしてください")}>見出しを短く</button><button disabled={props.revisionPending} onClick={() => props.setRevision("このスライドの要点を簡潔に言い換えてください")}>要点を簡潔に</button><button disabled={props.revisionPending} onClick={() => props.setRevision("このスライドの1つ目の箇条書きを短くしてください")}>箇条書きを短く</button></div>
      {props.revisionPending && <p className="revision-progress" role="status"><LoaderCircle className="spin" /> AIが修正案を検証しています</p>}
      {props.revisionSummary && <p className="revision-success" role="status"><Check /> {props.revisionSummary.targetSlides.map((number) => `${number}枚目`).join("・")}の{props.revisionSummary.changedTargets.length}箇所を検証して反映しました</p>}
      {props.error && <p className="error-message" role="alert">{props.error}</p>}
    </div>
  );
}

function SlidePreview({ result, index, setIndex }: { result: TeachingPackage; index: number; setIndex: Dispatch<SetStateAction<number>> }) {
  const slide = result.slides[index];
  if (!slide) return null;
  return (
    <div className="slide-layout">
      <SlideArtwork slide={slide} total={result.slides.length} />
      <aside className="speaker-notes"><div><p>講師ノート</p><span>{slide.speakerNotes.length}字 / {formatDuration(slideDurationSeconds(slide))}</span></div><h3>{slide.title}</h3><p>{slide.speakerNotes}</p></aside>
      <div className="slide-controls"><button className="icon-button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} title="前のスライド"><ChevronLeft /><span className="sr-only">前のスライド</span></button><span>{index + 1} / {result.slides.length}</span><button className="icon-button" onClick={() => setIndex((value) => Math.min(result.slides.length - 1, value + 1))} disabled={index === result.slides.length - 1} title="次のスライド"><ChevronRight /><span className="sr-only">次のスライド</span></button></div>
    </div>
  );
}
