import { expect, test } from "@playwright/test";

import { HOME_HEADING } from "../lib/content";

test("個人PWAは教材作成画面を表示する", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  await expect(page.getByText("公開体験版")).toBeVisible();
  await expect(page.getByRole("button", { name: "教材を作ってもらう" })).toBeVisible();
  await expect(page.getByText("生成機能は現在、一般公開していません")).toHaveCount(0);
});

test("個人PWAの生成入口は非課金の不正要求を400で拒否する", async ({ page }) => {
  const requests = [
    ["/api/generate", { multipart: {} }],
    ["/api/revise", { data: {} }],
    ["/api/render-slide", { data: {} }],
  ] as const;
  for (const [path, options] of requests) {
    const response = await page.request.post(path, options);
    expect(response.status(), path).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "BAD_REQUEST" });
  }
});

test("@mobile 個人PWAは横スクロールしない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});
