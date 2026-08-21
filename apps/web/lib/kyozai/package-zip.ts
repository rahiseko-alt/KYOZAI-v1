import JSZip from "jszip";

import type { RenderedSlideImage } from "./image-types";
import { packageHtml } from "./package-html";
import type { TeachingPackage } from "./types";

export function slideImageFilename(slideNumber: number, total: number) {
  if (slideNumber === 1) return "cover.png";
  if (slideNumber === total) return "action.png";
  return `slide-${String(slideNumber).padStart(2, "0")}.png`;
}

function contentAndScript(result: TeachingPackage) {
  return result.slides.map((slide) => [
    `# ${slide.number}. ${slide.title}`,
    slide.keyMessage,
    ...slide.bullets.map((bullet) => `- ${bullet}`),
    "",
    "講師台本:",
    slide.speakerNotes,
    `文字数: ${slide.scriptCharacters ?? [...slide.speakerNotes].length}字`,
    `目安時間: ${formatDuration(slide.durationSeconds ?? Math.round(([...slide.speakerNotes].length / 300) * 60))}`,
  ].join("\n")).join("\n\n");
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Base64(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", bytesFromBase64(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function finalizedResult(result: TeachingPackage) {
  const finalResult = structuredClone(result);
  if (!finalResult.process) return finalResult;
  finalResult.process.stageLedger = finalResult.process.stageLedger.map((entry) => {
    if (entry.stage === "image_generate") return { ...entry, status: "passed", inputs: ["frozen_deck", "image_prompts"], outputs: ["slide_images"], validator: "one-request-per-slide" };
    if (entry.stage === "image_validate") return { ...entry, status: "passed", inputs: ["slide_images"], outputs: ["image_validation", "montage"], validator: "all-final-images-passed" };
    if (entry.stage === "package") return { ...entry, status: "passed", inputs: ["validated_images", "deck_spec"], outputs: ["manifest", "package_zip"], validator: "manifest-and-artifact-integrity" };
    return entry;
  });
  return finalResult;
}

export async function createTeachingPackageZip(result: TeachingPackage, images: RenderedSlideImage[], montagePng: string) {
  if (images.length !== result.slides.length) throw new Error("全スライドの完成画像が揃っていません。");
  const ordered = [...images].sort((left, right) => left.slideNumber - right.slideNumber);
  if (ordered.some((image, index) => image.slideNumber !== index + 1 || image.validation.status !== "passed")) {
    throw new Error("検証済みの完成画像だけを納品できます。");
  }
  if (new Set(ordered.map((image) => image.modelId)).size !== 1) throw new Error("1教材内に異なる画像モデルが混在しています。");
  const actualHashes = await Promise.all(ordered.map((image) => sha256Base64(image.data)));
  if (ordered.some((image, index) => image.imageHash !== actualHashes[index])) throw new Error("完成PNGの実バイトと検証hashが一致しません。");
  const montageBytes = bytesFromBase64(montagePng);
  if (montageBytes.length < 8 || Array.from(montageBytes.slice(0, 8)).map((byte) => byte.toString(16).padStart(2, "0")).join("") !== "89504e470d0a1a0a") {
    throw new Error("montageが有効なPNGではありません。");
  }
  const zip = new JSZip();
  const finalResult = finalizedResult(result);
  const imageFolder = zip.folder("images");
  if (!imageFolder) throw new Error("画像フォルダーを作成できませんでした。");
  const imageEntries = ordered.map((image) => {
    const filename = slideImageFilename(image.slideNumber, result.slides.length);
    imageFolder.file(filename, image.data, { base64: true });
    return { path: `images/${filename}`, sha256: actualHashes[image.slideNumber - 1], slideNumber: image.slideNumber };
  });
  const manifest = {
    format: "kyozai-package@1.0.0",
    designProfile: finalResult.designProfile,
    imageModel: ordered[0]?.modelId,
    providerModel: ordered[0]?.providerModel,
    providerQuality: ordered[0]?.providerQuality,
    qaModel: ordered[0]?.qaModel,
    generatedSlideCount: ordered.length,
    deliverySize: "1672x941",
    previewAndPackageShareFinalPng: true,
    processContract: finalResult.process?.contract,
    sourceHash: finalResult.process?.source.sourceHash,
    contentFreezePassed: finalResult.process?.contentFreeze.passed,
    artifacts: [
      "deck-spec.json",
      "deck-content-and-script.txt",
      "source-info.json",
      "image-prompts.json",
      "image-validation.json",
      "montage.png",
      ...(finalResult.process ? ["stage-ledger.json"] : []),
      "index.html",
      ...imageEntries.map((entry) => entry.path),
    ],
    images: imageEntries,
  };
  zip.file("deck-spec.json", JSON.stringify(finalResult, null, 2));
  zip.file("deck-content-and-script.txt", contentAndScript(finalResult));
  zip.file("source-info.json", JSON.stringify({ summary: finalResult.sourceSummary, ...(finalResult.process?.source ?? {}) }, null, 2));
  if (finalResult.process) zip.file("stage-ledger.json", JSON.stringify(finalResult.process.stageLedger, null, 2));
  zip.file("image-prompts.json", JSON.stringify(ordered.map((image) => ({ slideNumber: image.slideNumber, modelId: image.modelId, providerModel: image.providerModel, providerQuality: image.providerQuality, qaModel: image.qaModel, prompt: image.prompt, promptHash: image.promptHash })), null, 2));
  zip.file("image-validation.json", JSON.stringify(ordered.map((image) => ({ slideNumber: image.slideNumber, imageHash: image.imageHash, attemptCount: image.attemptCount, ...image.validation })), null, 2));
  zip.file("montage.png", montagePng, { base64: true });
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("index.html", packageHtml(finalResult, ordered));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
