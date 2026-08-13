import { expect, test } from "@playwright/test";

import { HOME_HEADING } from "../lib/content";

test("トップページが見出しを表示する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  await expect(page.getByText("公開体験版")).toBeVisible();
  await expect(page.getByRole("button", { name: /履歴/ })).toBeDisabled();
});

test("資料から教材一式を生成し、AI修正を反映する", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "security-training.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("業務情報は承認された保存先だけに保存する。誤送信時は直ちに指定窓口へ報告する。"),
  });
  await page.getByRole("button", { name: "教材を作ってもらう" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "情報セキュリティ入門" })).toBeVisible();
  await expect(page.locator('.kz-slide[data-layout="cover"]')).toBeVisible();
  await expect(page.locator(".kz-slide")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  for (const layout of ["compare", "sequence", "focus", "evidence", "checklist", "action"]) {
    await page.getByRole("button", { name: "次のスライド" }).click();
    await expect(page.locator(`.kz-slide[data-layout="${layout}"]`)).toBeVisible();
    const dimensions = await page.locator(".kz-slide").evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  }
  await expect(page.getByRole("button", { name: /講師シナリオ/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "FAQ" })).toBeVisible();
  await expect(page.getByRole("button", { name: /確認テスト/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "印刷できるHTML教材を取得" }).click();
  await expect((await download).suggestedFilename()).toBe("kyozai-teaching-package.html");

  await page.getByPlaceholder(/もっと初心者向けに/).fill("タイトルを短くしてください");
  await page.getByTitle("修正を依頼").click();
  await expect(page.getByRole("heading", { level: 1, name: "情報セキュリティ入門（修正版）" })).toBeVisible();
});

test("@mobile 中核フローを完走できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect(page.locator(".mobile-menu")).toBeVisible();
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "mobile-training.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("顧客情報は承認された場所に保存し、事故時は直ちに報告する。"),
  });
  await page.getByRole("button", { name: "教材を作ってもらう" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "情報セキュリティ入門" })).toBeVisible();
  await expect(page.locator('.kz-slide[data-layout="cover"]')).toBeVisible();
  const completedDimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(completedDimensions.scroll).toBeLessThanOrEqual(completedDimensions.width);
  await page.getByPlaceholder(/もっと初心者向けに/).fill("タイトルを短くしてください");
  await page.getByTitle("修正を依頼").click();
  await expect(page.getByRole("heading", { level: 1, name: "情報セキュリティ入門（修正版）" })).toBeVisible();
});
