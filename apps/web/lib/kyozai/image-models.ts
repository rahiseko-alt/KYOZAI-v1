export const IMAGE_MODELS = {
  "gemini-3.1-flash-lite-image": {
    label: "Gemini 3.1 Flash Lite Image",
    description: "速度と費用を優先",
    provider: "google",
  },
  "gemini-3.1-flash-image": {
    label: "Gemini 3.1 Flash Image",
    description: "品質と速度の均衡",
    provider: "google",
  },
  "gpt-image-2-medium": {
    label: "GPT Image 2 Medium",
    description: "OpenAIの品質比較候補",
    provider: "openai",
  },
} as const;

export type ImageModelId = keyof typeof IMAGE_MODELS;

// 個人PWAの初期値はProduction canaryで実画像・QAまで確認済みの経路に固定する。
// Geminiは利用者が明示的に選べる比較候補として残し、Provider 429時はAPIが安全に案内する。
export const DEFAULT_PERSONAL_PWA_IMAGE_MODEL: ImageModelId = "gpt-image-2-medium";

export function isImageModelId(value: unknown): value is ImageModelId {
  return typeof value === "string" && value in IMAGE_MODELS;
}
