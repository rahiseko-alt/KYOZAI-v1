import { expect, test } from "@playwright/test";

import { HOME_HEADING } from "../lib/content";

test("E2E fixtureでログイン、添付upload、job進捗、ZIP取得まで完走する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();

  await page.getByLabel("メールアドレス").fill("e2e@example.invalid");
  await page.getByRole("button", { name: "確認メールを送信" }).click();
  await expect(page.getByText("E2E用の確認済みセッションを開始しました。")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "training.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("承認済みの保存先だけを使用する。事故時は指定窓口へ報告する。"),
  });
  await page.getByRole("radio", { name: /Gemini 3.1 Flash Lite Image/ }).check();
  await page.getByRole("button", { name: "教材jobを開始" }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+/);
  await expect(page.getByText("教材生成の進捗")).toBeVisible();
  await expect(page.getByRole("heading", { name: "完成しました" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("納品物を作成")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "教材一式をダウンロード" }).click();
  expect((await download).suggestedFilename()).toBe("kyozai-package.zip");
});

test("@mobile 非同期job入口は横スクロールしない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});
