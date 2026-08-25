import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JobArtifactList, JobStageList, jobStatusLabel } from "../app/job-workspace";

describe("永続jobの進捗表示", () => {
  it("実行中と失敗した工程を区別して表示する", () => {
    const html = renderToStaticMarkup(<JobStageList stages={[
      { stage: "analysis", status: "running", attempt: 0, inputArtifactIds: [], outputArtifactIds: [], validator: "schema" },
      { stage: "content_freeze", status: "failed", attempt: 1, inputArtifactIds: [], outputArtifactIds: [], validator: "freeze", errorCode: "CONTENT_INVALID" },
    ]} />);

    expect(html).toContain("実行中");
    expect(html).toContain("処理中です。");
    expect(html).toContain("失敗しました（CONTENT_INVALID）");
  });

  it("完成したpackage_zipを教材一式の主操作として表示する", () => {
    const html = renderToStaticMarkup(<JobArtifactList jobId="job_123" artifacts={[
      { artifactId: "artifact_zip", kind: "package_zip", revisionNumber: 1, storagePath: "private/package.zip", sha256: "a".repeat(64), mediaType: "application/zip", byteSize: 1024, status: "final" },
      { artifactId: "artifact_png", kind: "slide_image", revisionNumber: 1, storagePath: "private/slide.png", sha256: "b".repeat(64), mediaType: "image/png", byteSize: 2048, status: "final", slideNumber: 1 },
    ]} />);

    expect(html).toContain("教材一式をダウンロード");
    expect(html).toContain("教材一式をダウンロード");
    expect(html).toContain("個別ファイルをダウンロード");
    expect(html).not.toContain("private/package.zip");
  });

  it("終了状態を利用者向けの文言へ変換する", () => {
    expect(jobStatusLabel("completed")).toBe("完成しました");
    expect(jobStatusLabel("failed")).toBe("生成を完了できませんでした");
  });
});
