import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { createDurableMontage, createDurablePackage } from "../lib/kyozai/durable-package";
import { mockRenderedSlide } from "../lib/kyozai/image-renderer";
import { mockPackage } from "../lib/kyozai/mock";

describe("永続workerの納品パッケージ", () => {
  it("検証済みPNGだけからモンタージュとZIPをサーバー側で作る", async () => {
    const packageCopy = structuredClone(mockPackage);
    const rendered = await Promise.all(packageCopy.slides.map((slide) => mockRenderedSlide(packageCopy, slide, "gemini-3.1-flash-lite-image")));
    const images = rendered.map((image) => ({ ...image, bytes: Buffer.from(image.data, "base64") }));
    const montage = await createDurableMontage(images.map((image) => ({ slideNumber: image.slideNumber, bytes: image.bytes })));
    expect(montage.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const built = await createDurablePackage(packageCopy, images, montage);
    const archive = await JSZip.loadAsync(built.packageZip);
    expect(Object.keys(archive.files)).toEqual(expect.arrayContaining(["deck-spec.json", "manifest.json", "montage.png", "images/cover.png", "images/action.png"]));
    const manifest = JSON.parse(await archive.file("manifest.json")!.async("string")) as { images: Array<{ sha256: string }> };
    expect(manifest.images).toHaveLength(packageCopy.slides.length);
    expect(manifest.images[0]?.sha256).toBe(images[0]?.imageHash);
  });

  it("PNG hashが異なる完成物はZIP化しない", async () => {
    const packageCopy = structuredClone(mockPackage);
    const rendered = await mockRenderedSlide(packageCopy, packageCopy.slides[0]!, "gemini-3.1-flash-lite-image");
    const image = { ...rendered, bytes: Buffer.from(rendered.data, "base64"), imageHash: "0".repeat(64) };
    await expect(createDurablePackage({ ...packageCopy, slides: [packageCopy.slides[0]!] }, [image], Buffer.from("png"))).rejects.toThrow("package_image_integrity_failed");
  });
});
