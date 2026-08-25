"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  artifactDownloadPath,
  fetchJobSnapshot,
  getJobIdFromSearch,
  isTerminalJobStatus,
  pollDelayMs,
  type FetchLike,
  type KyozaiJobSnapshot,
  writeJobIdToUrl,
} from "@/lib/kyozai/job-client";

type JobWorkspaceProps = {
  initialJobId?: string;
  fetcher?: FetchLike;
};

const stageLabels: Record<string, string> = {
  source_ingest: "入力を確認",
  analysis: "教材内容を分析",
  slide_map: "スライド構成を設計",
  script_timing: "講師台本と時間を計算",
  content_freeze: "内容を確定",
  design: "デザインを設計",
  image_generate: "完成画像を生成",
  image_validate: "画像を検証",
  package: "納品物を作成",
  finalize: "納品物を確定",
};

function stageLabel(name: string): string {
  return stageLabels[name] ?? name;
}

function artifactLabel(artifact: KyozaiJobSnapshot["artifacts"][number]): string {
  const slide = artifact.slideNumber === undefined ? "" : `（${artifact.slideNumber}枚目）`;
  return `${artifact.kind}${slide}`;
}

export function JobWorkspace({ initialJobId, fetcher }: JobWorkspaceProps) {
  const [jobId] = useState<string | undefined>(() => initialJobId ?? (typeof window === "undefined" ? undefined : getJobIdFromSearch(window.location.search)));
  const [job, setJob] = useState<KyozaiJobSnapshot>();
  const [error, setError] = useState<string>();
  const fetchRef = useRef<FetchLike>(fetcher ?? fetch);

  useEffect(() => {
    fetchRef.current = fetcher ?? fetch;
  }, [fetcher]);

  useEffect(() => {
    if (!jobId || typeof window === "undefined") return;
    writeJobIdToUrl(jobId, window.location, window.history);
  }, [jobId]);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    try {
      const snapshot = await fetchJobSnapshot(jobId, fetchRef.current);
      setJob(snapshot);
      setError(undefined);
      return snapshot;
    } catch {
      setError("進捗を取得できませんでした。通信を確認して、もう一度お試しください。");
      return undefined;
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const snapshot = await refresh();
      if (!active) return;
      const delay = pollDelayMs(snapshot?.status ?? "queued");
      if (delay) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, refresh]);

  if (!jobId) {
    return <section aria-live="polite"><p>表示する教材jobがありません。</p></section>;
  }

  return (
    <section aria-live="polite" data-job-id={jobId}>
      <p>教材生成の進捗</p>
      <h1>{job ? job.status : "進捗を読み込み中"}</h1>
      <p>job: {jobId}</p>
      {job?.currentStage ? <p>現在の工程: {stageLabel(job.currentStage)}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {job ? <button type="button" onClick={() => void refresh()}>更新</button> : null}

      {job ? (
        <>
          <h2>工程</h2>
          <ol>
            {job.stages.map((stage) => (
              <li key={`${stage.stage}-${stage.slideNumber ?? "all"}-${stage.attempt}`} data-stage-status={stage.status}>
                <strong>{stageLabel(stage.stage)}</strong> — {stage.status}（試行 {stage.attempt}）
                {stage.errorCode ? <span> {stage.errorCode}</span> : null}
              </li>
            ))}
          </ol>
          {job.warning ? <p role="status">{job.warning}</p> : null}
          {job.errorCode ? <p role="alert">生成を完了できませんでした（{job.errorCode}）。</p> : null}
          <h2>成果物</h2>
          {job.artifacts.length === 0 ? <p>検証済みの成果物はまだありません。</p> : (
            <ul>
              {job.artifacts.map((artifact) => (
                <li key={artifact.artifactId}>
                  <strong>{artifactLabel(artifact)}</strong> — {artifact.status}、{artifact.mediaType}、{artifact.byteSize} bytes
                  {artifact.status === "final" ? <a href={artifactDownloadPath(jobId, artifact.artifactId)}>ダウンロード</a> : null}
                </li>
              ))}
            </ul>
          )}
          {isTerminalJobStatus(job.status) ? <p>このjobは終了しています。</p> : null}
        </>
      ) : null}
    </section>
  );
}
