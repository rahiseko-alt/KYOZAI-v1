import type { ImageModelId } from "./image-models";

export type RenderedSlideImage = {
  slideNumber: number;
  modelId: ImageModelId;
  providerModel: string;
  providerQuality: "1K" | "medium";
  qaModel: string;
  mimeType: "image/png";
  data: string;
  width: 1672;
  height: 941;
  imageHash: string;
  prompt: string;
  promptHash: string;
  attemptCount: number;
  validation: {
    status: "passed";
    structuralChecks: string[];
    visualChecks: string[];
  };
};

export function imageDataUrl(image: RenderedSlideImage) {
  return `data:${image.mimeType};base64,${image.data}`;
}
