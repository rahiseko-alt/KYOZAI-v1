import { isPublicProduction } from "../lib/kyozai/generation-access";
import { PublicPortfolio } from "./public-portfolio";
import { Workspace } from "./workspace";

export default function HomePage() {
  if (isPublicProduction()) return <PublicPortfolio />;
  return <Workspace />;
}
