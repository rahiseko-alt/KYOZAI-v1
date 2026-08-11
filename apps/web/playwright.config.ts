import { defineConfig, devices } from "@playwright/test";

// サーバの起動・停止は webServer に任せる。データの保存先（Supabase 等）を使う
// 案件になったら、scripts/e2e.sh 側でその起動と投入だけを行う
// （AGENTS.md「結合を増やさない」2）。
const PORT = process.env.E2E_PORT ?? "3125";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    // 本番相当のビルド（next start）を検査する。scripts/e2e.sh 実行前に
    // `pnpm -r build` 済みであることが前提（scripts/smoke.sh と同じ前提）。
    command: `pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    // サーバ側の例外（Server Component / Server Action のエラー）をテストのログに出す。
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // モバイル幅での操作が肝心な案件になったら、名前に @mobile を含むテストだけを
    // 拾う2つ目のプロジェクトを足す（CIが入れているブラウザは chromium だけなので、
    // 端末は Chromium 系〈Pixel 5 等〉を使う。WebKit 系の端末指定は起動できずに落ちる）。
  ],
});
