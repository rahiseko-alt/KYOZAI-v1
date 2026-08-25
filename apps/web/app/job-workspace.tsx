"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchJobArtifact,
  fetchJobSnapshot,
  getJobIdFromSearch,
  isTerminalJobStatus,
  pollDelayMs,
  type FetchLike,
  type KyozaiJobSnapshot,
  writeJobIdToUrl,
} from "../lib/kyozai/job-client";
import type { ArtifactManifestEntry, KyozaiJobStatus, StageLedgerEntry } from "../../../shared/kyozai-job-contract";

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

export function jobStatusLabel(status: KyozaiJobStatus): string {
  const labels: Record<KyozaiJobStatus, string> = {
    queued: "開始待ちです",
    running: "生成中です",
    completed: "完成しました",
    failed: "生成を完了できませんでした",
    cancelling: "キャンセル処理中です",
    cancelled: "キャンセルしました",
    deleting: "削除処理中です",
    deleted: "削除しました",
  };
  return labels[status];
}

export function stageStatusLabel(status: StageLedgerEntry["status"]): string {
  const labels: Record<StageLedgerEntry["status"], string> = {
    pending: "待機中",
    running: "実行中",
    passed: "完了",
    failed: "失敗",
    skipped: "対象外",
  };
  return labels[status];
}

export function finalPackageArtifact(artifacts: ArtifactManifestEntry[]): ArtifactManifestEntry | undefined {
  return artifacts.find((artifact) => artifact.kind === "package_zip" && artifact.status === "final");
}

export function JobStageList({ stages }: { stages: StageLedgerEntry[] }) {
  if (stages.length === 0) return <p>工程の開始を待っています。</p>;
  return (
    <ol>
      {stages.map((stage) => (
        <li key={`${stage.stage}-${stage.slideNumber ?? "all"}-${stage.attempt}`} data-stage-status={stage.status}>
          <strong>{stageLabel(stage.stage)}</strong> — {stageStatusLabel(stage.status)}（試行 {stage.attempt + 1}）
          {stage.status === "running" ? <span> 処理中です。</span> : null}
          {stage.status === "failed" ? <span role="alert"> 失敗しました{stage.errorCode ? `（${stage.errorCode}）` : "。"}</span> : null}
          {stage.status !== "failed" && stage.errorCode ? <span> {stage.errorCode}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function JobArtifactList({ jobId, artifacts, fetcher }: { jobId: string; artifacts: ArtifactManifestEntry[]; fetcher?: FetchLike }) {
  const packageArtifact = finalPackageArtifact(artifacts);
  const [downloadError, setDownloadError] = useState<string>();
  const [downloading, setDownloading] = useState<string>();

  const download = async (artifact: ArtifactManifestEntry) => {
    setDownloading(artifact.artifactId);
    setDownloadError(undefined);
    try {
      const blob = await fetchJobArtifact(jobId, artifact.artifactId, fetcher);
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = artifact.kind === "package_zip" ? "kyozai-package.zip" : `kyozai-${artifact.kind}${artifact.slideNumber ? `-${artifact.slideNumber}` : ""}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      setDownloadError("成果物を取得できませんでした。ログイン状態を確認して、もう一度お試しください。");
    } finally {
      setDownloading(undefined);
    }
  };

  return (
    <>
      {packageArtifact ? (
        <p>
          <button type="button" onClick={() => void download(packageArtifact)} disabled={Boolean(downloading)}>教材一式をダウンロード</button>
        </p>
      ) : <p>教材一式は、すべての工程が完了してから取得できます。</p>}
      {artifacts.length === 0 ? <p>検証済みの成果物はまだありません。</p> : (
        <ul>
          {artifacts.map((artifact) => (
            <li key={artifact.artifactId}>
              <strong>{artifactLabel(artifact)}</strong> — {artifact.status}、{artifact.mediaType}、{artifact.byteSize} bytes
              {artifact.status === "final" && artifact.kind !== "package_zip" ? <button type="button" onClick={() => void download(artifact)} disabled={Boolean(downloading)}>個別ファイルをダウンロード</button> : null}
            </li>
          ))}
        </ul>
      )}
      {downloadError ? <p role="alert">{downloadError}</p> : null}
    </>
  );
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
      <h1>{job ? jobStatusLabel(job.status) : "進捗を読み込み中"}</h1>
      <p>job: {jobId}</p>
      {job?.currentStage ? <p>現在の工程: {stageLabel(job.currentStage)}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {job ? <button type="button" onClick={() => void refresh()}>更新</button> : null}

      {job ? (
        <>
          <h2>工程</h2>
          <JobStageList stages={job.stages} />
          {job.warning ? <p role="status">{job.warning}</p> : null}
          {job.errorCode ? <p role="alert">生成を完了できませんでした（{job.errorCode}）。</p> : null}
          <h2>成果物</h2>
          <JobArtifactList jobId={jobId} artifacts={job.artifacts} fetcher={fetcher} />
          {isTerminalJobStatus(job.status) ? <p>{job.status === "completed" ? "教材の生成は完了しています。" : "このjobは終了しています。"}</p> : null}
        </>
      ) : null}
    </section>
  );
}
