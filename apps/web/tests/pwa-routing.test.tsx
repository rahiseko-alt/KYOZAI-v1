import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage from "../app/page";

describe("個人PWAのProduction入口", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("フラグ無しのProductionはPortfolioへ閉じる", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain("生成機能は現在、一般公開していません");
  });

  it("個人PWAフラグ有りのProductionは直接生成Workspaceを表示する", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("KYOZAI_PERSONAL_PWA_ENABLED", "1");
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain("公開体験版");
    expect(html).not.toContain("生成機能は現在、一般公開していません");
  });
});
