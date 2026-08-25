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
    // DB・AI・Storageに接続しないprocess-local fixtureで、非同期job UIの
    // 境界だけをブラウザ検証する。Production封鎖はsecurity-boundaries.test.tsで
    // 本番環境変数を明示して別途検証する。
    env: { VERCEL_ENV: "preview", KYOZAI_E2E_MODE: "1", KYOZAI_ASYNC_JOBS_ENABLED: "1" },
  },
  projects: [
    { name: "chromium", grepInvert: /@mobile/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", grep: /@mobile/, use: { ...devices["Pixel 5"] } },
  ],
});
