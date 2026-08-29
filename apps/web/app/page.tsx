import { isPublicProduction, personalPwaEnabled } from "../lib/kyozai/generation-access";
import { AsyncJobWorkspace } from "./async-job-workspace";
import { PublicPortfolio } from "./public-portfolio";
import { Workspace } from "./workspace";

export default function HomePage() {
  if (isPublicProduction() && !personalPwaEnabled()) return <PublicPortfolio />;
  if (personalPwaEnabled()) return <Workspace />;
  return <AsyncJobWorkspace />;
}
