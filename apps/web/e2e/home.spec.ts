import { expect, test } from "@playwright/test";

import { HOME_HEADING } from "../lib/content";

test("公開Productionは教材生成を提供せず、ポートフォリオを表示する", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  await expect(page.getByText("生成機能は現在、一般公開していません")).toBeVisible();
  await expect(page.getByText("教材スライド")).toBeVisible();
  await expect(page.getByText("納品ZIP")).toBeVisible();
  await expect(page.getByRole("button", { name: /教材jobを開始|教材を作ってもらう/ })).toHaveCount(0);
});

test("公開Productionでは全ての生成入口が404", async ({ page }) => {
  for (const path of ["/api/generate", "/api/revise", "/api/render-slide", "/api/jobs", "/api/uploads"]) {
    const response = await page.request.post(path, { data: {} });
    expect(response.status(), path).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  }
});

test("@mobile 公開ページは横スクロールしない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
});
