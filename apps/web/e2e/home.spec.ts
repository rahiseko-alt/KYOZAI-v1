import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";

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
  await page.getByRole("radio", { name: /Gemini 3.1 Flash Lite Image/ }).check();
  await page.getByRole("button", { name: "教材を作ってもらう" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "情報セキュリティ入門" })).toBeVisible();
  await expect(page.locator(".final-slide-preview img")).toBeVisible();
  const coverPreview = await page.locator(".final-slide-preview img").getAttribute("src");
  const individualDownload = page.waitForEvent("download");
  await page.getByTitle("この完成PNGを取得").click();
  const individual = await individualDownload;
  expect(individual.suggestedFilename()).toBe("cover.png");
  const individualPath = await individual.path();
  expect(individualPath).toBeTruthy();
  const individualBytes = await readFile(individualPath!);
  expect(coverPreview?.split(",")[1]).toBe(individualBytes.toString("base64"));
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole("button", { name: "次のスライド" }).click();
    await expect(page.locator(".final-slide-preview img")).toBeVisible();
    const dimensions = await page.locator(".final-slide-preview").evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
  }
  await expect(page.getByRole("button", { name: /講師シナリオ/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "FAQ" })).toBeVisible();
  await expect(page.getByRole("button", { name: /確認テスト/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "完成PNG・台本・検証ZIPを取得" }).click();
  const packageDownload = await download;
  await expect(packageDownload.suggestedFilename()).toBe("kyozai-teaching-package.zip");
  const packagePath = await packageDownload.path();
  const zip = await JSZip.loadAsync(await readFile(packagePath!));
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("text")) as { imageModel: string; images: Array<{ path: string; sha256: string }> };
  expect(manifest.imageModel).toBe("gemini-3.1-flash-lite-image");
  expect(manifest.images).toHaveLength(7);
  for (const entry of manifest.images) {
    const bytes = Buffer.from(await zip.file(entry.path)!.async("uint8array"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    await expect(sharp(bytes).metadata()).resolves.toMatchObject({ width: 1672, height: 941, format: "png" });
  }
  expect(Buffer.from(await zip.file("images/cover.png")!.async("uint8array"))).toEqual(individualBytes);
  await expect(sharp(Buffer.from(await zip.file("montage.png")!.async("uint8array"))).metadata()).resolves.toMatchObject({ format: "png" });

  await page.getByPlaceholder(/もっと初心者向けに/).fill("タイトルを短くしてください");
  await page.getByRole("radio", { name: /Gemini 3.1 Flash Image/ }).check();
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
  await page.getByRole("radio", { name: /GPT Image 2 Medium/ }).check();
  await page.getByRole("button", { name: "教材を作ってもらう" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "情報セキュリティ入門" })).toBeVisible();
  await expect(page.locator(".final-slide-preview img")).toBeVisible();
  const completedDimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(completedDimensions.scroll).toBeLessThanOrEqual(completedDimensions.width);
  await page.getByPlaceholder(/もっと初心者向けに/).fill("タイトルを短くしてください");
  await page.getByRole("radio", { name: /GPT Image 2 Medium/ }).check();
  await page.getByTitle("修正を依頼").click();
  await expect(page.getByRole("heading", { level: 1, name: "情報セキュリティ入門（修正版）" })).toBeVisible();
});
