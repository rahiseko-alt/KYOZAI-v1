import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicPortfolio } from "../app/public-portfolio";
import { HOME_HEADING } from "../lib/content";

describe("Productionの公開ページ", () => {
  it("生成フォームを配信せず限定公開ポートフォリオを表示する", () => {
    const html = renderToStaticMarkup(<PublicPortfolio />);

    expect(html).toContain(HOME_HEADING);
    expect(html).toContain("生成機能は現在、一般公開していません");
    expect(html).not.toContain("教材を作ってもらう");
    expect(html).not.toContain("type=\"file\"");
  });
});
