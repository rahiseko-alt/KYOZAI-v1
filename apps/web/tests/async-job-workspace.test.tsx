import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AsyncJobWorkspace } from "../app/async-job-workspace";

describe("非同期job作成入口", () => {
  it("同期生成APIやブラウザZIPを表示せず、認証済みjob作成を案内する", () => {
    const html = renderToStaticMarkup(<AsyncJobWorkspace />);

    expect(html).toContain("認証済み検証環境");
    expect(html).toContain("ログイン状態を確認しています。");
    expect(html).not.toContain("/api/generate");
    expect(html).not.toContain("完成PNG・台本・検証ZIPを取得");
  });
});
