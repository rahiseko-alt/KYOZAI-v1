export const JOB_QUERY_KEY = "job";

export type KyozaiJobStatus = "queued" | "running" | "completed" | "failed" | "cancelling" | "cancelled" | "deleting" | "deleted";
export type JobStageStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export type JobStage = {
  name: string;
  status: JobStageStatus;
  attempt: number;
  updatedAt?: string;
  errorCode?: string;
};

export type JobArtifact = {
  id: string;
  kind: string;
  lifecycle: "draft" | "validated" | "final" | "deleted";
  mediaType: string;
  byteSize: number;
  sha256: string;
  slideNumber?: number;
};

export type KyozaiJobSnapshot = {
  id: string;
  status: KyozaiJobStatus;
  currentStage?: string;
  revision: number;
  stages: JobStage[];
  artifacts: JobArtifact[];
  warning?: string;
  errorCode?: string;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const terminalStatuses: ReadonlySet<KyozaiJobStatus> = new Set(["completed", "failed", "cancelled", "deleted"]);
const jobIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export function getJobIdFromSearch(search: string): string | undefined {
  const candidate = new URLSearchParams(search).get(JOB_QUERY_KEY);
  return candidate && jobIdPattern.test(candidate) ? candidate : undefined;
}

export function writeJobIdToUrl(jobId: string, location: Location, history: History): void {
  const url = new URL(location.href);
  url.searchParams.set(JOB_QUERY_KEY, jobId);
  history.replaceState(null, "", url);
}

export function isTerminalJobStatus(status: KyozaiJobStatus): boolean {
  return terminalStatuses.has(status);
}

export function pollDelayMs(status: KyozaiJobStatus): number | undefined {
  if (isTerminalJobStatus(status)) return undefined;
  return status === "queued" ? 3_000 : 2_000;
}

export async function fetchJobSnapshot(jobId: string, fetcher: FetchLike = fetch): Promise<KyozaiJobSnapshot> {
  const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`job_request_failed:${response.status}`);
  return await response.json() as KyozaiJobSnapshot;
}
