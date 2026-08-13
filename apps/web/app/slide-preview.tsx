import Image from "next/image";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { formatDuration, slideDurationSeconds } from "@/lib/kyozai/design";
import { imageDataUrl, type RenderedSlideImage } from "@/lib/kyozai/image-types";
import { slideImageFilename } from "@/lib/kyozai/package-zip";
import type { TeachingPackage } from "@/lib/kyozai/types";

export function SlidePreview({ result, images, index, setIndex }: { result: TeachingPackage; images: RenderedSlideImage[]; index: number; setIndex: Dispatch<SetStateAction<number>> }) {
  const slide = result.slides[index];
  const image = slide ? images.find((item) => item.slideNumber === slide.number) : undefined;
  if (!slide || !image) return null;
  const duration = slideDurationSeconds(slide);
  const downloadImage = () => {
    const anchor = document.createElement("a");
    anchor.href = imageDataUrl(image);
    anchor.download = slideImageFilename(slide.number, result.slides.length);
    anchor.click();
  };
  return (
    <div className="slide-layout">
      <div className="final-slide-preview"><Image src={imageDataUrl(image)} alt={slide.title} width={1672} height={941} unoptimized /><button className="icon-button image-download" onClick={downloadImage} title="この完成PNGを取得"><Download /><span className="sr-only">この完成PNGを取得</span></button></div>
      <aside className="speaker-notes"><div><p>講師ノート</p><span>{slide.speakerNotes.length}字 / {formatDuration(duration)}</span></div><h3>{slide.title}</h3><p>{slide.speakerNotes}</p></aside>
      <div className="slide-controls"><button className="icon-button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} title="前のスライド"><ChevronLeft /><span className="sr-only">前のスライド</span></button><span>{index + 1} / {result.slides.length}</span><button className="icon-button" onClick={() => setIndex((value) => Math.min(result.slides.length - 1, value + 1))} disabled={index === result.slides.length - 1} title="次のスライド"><ChevronRight /><span className="sr-only">次のスライド</span></button></div>
    </div>
  );
}
