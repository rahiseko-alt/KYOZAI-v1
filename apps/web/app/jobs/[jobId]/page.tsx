import { notFound } from "next/navigation";

import { JobWorkspace } from "../../job-workspace";
import { isPublicProduction } from "../../../lib/kyozai/generation-access";

type PageProps = { params: Promise<{ jobId: string }> };

export default async function JobPage({ params }: PageProps) {
  if (isPublicProduction()) notFound();
  const { jobId } = await params;
  return <JobWorkspace initialJobId={jobId} />;
}
