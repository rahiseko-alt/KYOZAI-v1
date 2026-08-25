import { createHash } from "node:crypto";

import JSZip from "jszip";
import sharp from "sharp";

import { slideImageFilename } from "./package-zip";
import type { RenderedSlideImage } from "./image-types";
import type { TeachingPackage } from "./types";

export type DurablePackageArtifact = {
  kind: "deck_spec" | "deck_content_and_script" | "source_info" | "image_prompts" | "image_validation" | "montage" | "manifest" | "package_zip";
  name: string;
  mediaType: string;
  bytes: Buffer;
};

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
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
    `目安時間: ${Math.floor((slide.durationSeconds ?? 0) / 60)}:${String((slide.durationSeconds ?? 0) % 60).padStart(2, "0")}`,
  ].join("\n")).join("\n\n");
}

/** Creates a server-side montage. Browser canvas is deliberately not part of worker execution. */
export async function createDurableMontage(images: Array<{ slideNumber: number; bytes: Buffer }>) {
  const cellWidth = 836;
  const cellHeight = 471;
  const rows = Math.ceil(images.length / 2);
  const cells = await Promise.all([...images].sort((a, b) => a.slideNumber - b.slideNumber).map(async (image, index) => ({
    input: await sharp(image.bytes).resize(cellWidth, cellHeight, { fit: "contain", background: "white" }).png().toBuffer(),
    left: (index % 2) * cellWidth,
    top: Math.floor(index / 2) * cellHeight,
  })));
  return sharp({ create: { width: cellWidth * 2, height: cellHeight * rows, channels: 3, background: "white" } })
    .composite(cells)
    .png()
    .toBuffer();
}

/** Packages only the final, validated PNG bytes owned by this revision. */
export async function createDurablePackage(result: TeachingPackage, images: Array<RenderedSlideImage & { bytes: Buffer }>, montage: Buffer) {
  if (images.length !== result.slides.length) throw new Error("package_images_incomplete");
  const ordered = [...images].sort((a, b) => a.slideNumber - b.slideNumber);
  if (ordered.some((image, index) => image.slideNumber !== index + 1 || sha256(image.bytes) !== image.imageHash)) throw new Error("package_image_integrity_failed");
  const zip = new JSZip();
  const imageEntries = ordered.map((image) => {
    const filename = slideImageFilename(image.slideNumber, result.slides.length);
    zip.file(`images/${filename}`, image.bytes);
    return { path: `images/${filename}`, sha256: image.imageHash, slideNumber: image.slideNumber };
  });
  const deckSpec = Buffer.from(JSON.stringify(result, null, 2));
  const script = Buffer.from(contentAndScript(result));
  const sourceInfo = Buffer.from(JSON.stringify({ summary: result.sourceSummary, ...(result.process?.source ?? {}) }, null, 2));
  const prompts = Buffer.from(JSON.stringify(ordered.map((image) => ({ slideNumber: image.slideNumber, modelId: image.modelId, providerModel: image.providerModel, providerQuality: image.providerQuality, qaModel: image.qaModel, prompt: image.prompt, promptHash: image.promptHash })), null, 2));
  const validation = Buffer.from(JSON.stringify(ordered.map((image) => ({ slideNumber: image.slideNumber, imageHash: image.imageHash, attemptCount: image.attemptCount, ...image.validation })), null, 2));
  const stageLedger = Buffer.from(JSON.stringify(result.process?.stageLedger ?? [], null, 2));
  const manifest = Buffer.from(JSON.stringify({
    format: "kyozai-package@1.0.0", designProfile: result.designProfile, sourceHash: result.process?.source.sourceHash,
    contentFreezePassed: result.process?.contentFreeze.passed === true, generatedSlideCount: ordered.length,
    deliverySize: "1672x941", previewAndPackageShareFinalPng: true, images: imageEntries,
    artifacts: ["deck-spec.json", "deck-content-and-script.txt", "source-info.json", "image-prompts.json", "image-validation.json", "stage-ledger.json", "montage.png", ...imageEntries.map((entry) => entry.path)],
  }, null, 2));
  zip.file("deck-spec.json", deckSpec); zip.file("deck-content-and-script.txt", script); zip.file("source-info.json", sourceInfo);
  zip.file("image-prompts.json", prompts); zip.file("image-validation.json", validation); zip.file("stage-ledger.json", stageLedger);
  zip.file("montage.png", montage); zip.file("manifest.json", manifest);
  const packageZip = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  return { packageZip, artifacts: [
    { kind: "deck_spec" as const, name: "deck-spec.json", mediaType: "application/json", bytes: deckSpec },
    { kind: "deck_content_and_script" as const, name: "deck-content-and-script.txt", mediaType: "text/plain", bytes: script },
    { kind: "source_info" as const, name: "source-info.json", mediaType: "application/json", bytes: sourceInfo },
    { kind: "image_prompts" as const, name: "image-prompts.json", mediaType: "application/json", bytes: prompts },
    { kind: "image_validation" as const, name: "image-validation.json", mediaType: "application/json", bytes: validation },
    { kind: "montage" as const, name: "montage.png", mediaType: "image/png", bytes: montage },
    { kind: "manifest" as const, name: "manifest.json", mediaType: "application/json", bytes: manifest },
  ] satisfies DurablePackageArtifact[] };
}
