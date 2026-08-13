import { expect, test, type Page } from "@playwright/test";

import { HOME_HEADING } from "../lib/content";

const INITIAL_SLIDE_TITLE = "情報セキュリティ入門";
const REVISED_SLIDE_TITLE = `${INITIAL_SLIDE_TITLE}（修正版）`;

async function generatePackage(page: Page, fileName: string, content: string) {
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await page.getByRole("button", { name: "教材を作ってもらう" }).click();
  await expect(page.getByRole("heading", { level: 1, name: INITIAL_SLIDE_TITLE })).toBeVisible();
  await expect(page.locator('.kz-slide[data-layout="cover"]')).toBeVisible();
}

async function verifyLocalRevisionLifecycle(page: Page) {
  const slideTitle = page.locator(".kz-slide h2");
  const revisionInput = page.getByPlaceholder("例：このスライドの見出しを短くしてください");

  await expect(slideTitle).toHaveText(INITIAL_SLIDE_TITLE);
  await revisionInput.fill("このスライドの見出しを短くしてください");
  await page.getByTitle("修正を依頼").click();
  await expect(page.locator(".revision-success")).toContainText("1枚目の1箇所を検証して反映しました");
  await expect(slideTitle).toHaveText(REVISED_SLIDE_TITLE);
  await expect(page.getByRole("heading", { level: 1, name: INITIAL_SLIDE_TITLE })).toBeVisible();

  await revisionInput.fill("教材全体を初心者向けにしてください");
  await page.getByTitle("修正を依頼").click();
  await expect(page.locator(".error-message[role=alert]")).toContainText("Phase 1では1〜3枚のスライドを指定してください");
  await expect(slideTitle).toHaveText(REVISED_SLIDE_TITLE);

  await page.getByTitle("前の版へ戻す").click();
  await expect(slideTitle).toHaveText(INITIAL_SLIDE_TITLE);
  await page.getByTitle("次の版へ進む").click();
  await expect(slideTitle).toHaveText(REVISED_SLIDE_TITLE);

  let releaseRequest: (() => void) | undefined;
  const requestGate = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route("**/api/revise", async (route) => {
    await requestGate;
    await route.continue().catch(() => undefined);
  }, { times: 1 });
  await revisionInput.fill("このスライドの見出しをさらに短くしてください");
  await page.getByTitle("修正を依頼").click();
  await expect(page.locator(".revision-progress")).toBeVisible();
  await page.getByTitle("修正を中止").click();
  await expect(page.locator(".error-message[role=alert]")).toContainText("元の教材を表示しています");
  releaseRequest?.();
  await page.waitForTimeout(150);
  await expect(slideTitle).toHaveText(REVISED_SLIDE_TITLE);
}

test("トップページが見出しを表示する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  await expect(page.getByText("公開体験版")).toBeVisible();
  await expect(page.getByRole("button", { name: /履歴/ })).toBeDisabled();
});

test("資料から教材一式を生成し、AI修正を反映する", async ({ page }) => {
  await page.goto("/");
  await generatePackage(page, "security-training.txt", "業務情報は承認された保存先だけに保存する。誤送信時は直ちに指定窓口へ報告する。");
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

  for (let index = 0; index < 6; index += 1) await page.getByRole("button", { name: "前のスライド" }).click();
  await expect(page.locator('.kz-slide[data-layout="cover"]')).toBeVisible();
  await verifyLocalRevisionLifecycle(page);
});

test("@mobile 局所AI修正の成功、拒否、Undo/Redoを維持する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  const initialDimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(initialDimensions.scroll).toBeLessThanOrEqual(initialDimensions.width);
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect(page.locator(".mobile-menu")).toBeVisible();
  await page.getByRole("button", { name: "メニューを開く" }).click();

  await generatePackage(page, "mobile-training.txt", "顧客情報は承認された場所に保存し、事故時は直ちに報告する。");
  const completedDimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(completedDimensions.scroll).toBeLessThanOrEqual(completedDimensions.width);
  await verifyLocalRevisionLifecycle(page);
});

test("@mobile 画面幅を超えず中核フローを完走できる", async ({ page }) => {
  await page.goto("/");
  await generatePackage(page, "mobile-layout-training.txt", "顧客情報は承認された場所に保存し、事故時は直ちに報告する。");
  await expect(page.getByRole("button", { name: /講師シナリオ/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "FAQ" })).toBeVisible();
  await expect(page.getByRole("button", { name: /確認テスト/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});
