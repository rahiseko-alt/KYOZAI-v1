import { expect, test } from "@playwright/test";

import { HOME_HEADING } from "../lib/content";

test("トップページが見出しを表示する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
});
