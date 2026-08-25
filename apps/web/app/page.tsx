import { isPublicProduction } from "../lib/kyozai/generation-access";
import { AsyncJobWorkspace } from "./async-job-workspace";
import { PublicPortfolio } from "./public-portfolio";

export default function HomePage() {
  if (isPublicProduction()) return <PublicPortfolio />;
  return <AsyncJobWorkspace />;
}
