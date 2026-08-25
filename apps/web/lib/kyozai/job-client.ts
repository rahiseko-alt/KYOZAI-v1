import { isTerminalJobStatus as isTerminalContractJobStatus, type ArtifactManifestEntry, type KyozaiJob, type KyozaiJobStatus, type StageLedgerEntry } from "../../../../shared/kyozai-job-contract";

export const JOB_QUERY_KEY = "job";

export type KyozaiJobSnapshot = Pick<KyozaiJob, "id" | "status" | "currentStage"> & {
  revision: number;
  stages: StageLedgerEntry[];
  artifacts: ArtifactManifestEntry[];
  warning?: string;
  errorCode?: string;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type { KyozaiJobStatus } from "../../../../shared/kyozai-job-contract";

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
  return isTerminalContractJobStatus(status);
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

export function artifactDownloadPath(jobId: string, artifactId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`;
}
