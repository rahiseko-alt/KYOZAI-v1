import { imageDataUrl, type RenderedSlideImage } from "./image-types";

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("montage用の完成画像を読み込めませんでした。"));
    image.src = src;
  });
}

export async function createMontagePng(images: RenderedSlideImage[]) {
  const columns = 2;
  const cellWidth = 836;
  const cellHeight = 471;
  const rows = Math.ceil(images.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = cellWidth * columns;
  canvas.height = cellHeight * rows;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("montageを作成できませんでした。");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const ordered = [...images].sort((left, right) => left.slideNumber - right.slideNumber);
  const loaded = await Promise.all(ordered.map((image) => loadImage(imageDataUrl(image))));
  loaded.forEach((image, index) => {
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    context.drawImage(image, x, y, cellWidth, cellHeight);
  });
  const dataUrl = canvas.toDataURL("image/png");
  const data = dataUrl.split(",")[1];
  if (!data) throw new Error("montageのPNGデータを作成できませんでした。");
  return data;
}
