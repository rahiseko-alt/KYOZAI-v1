import type { TeachingPackage } from "./types";
import type { RenderedSlideImage } from "./image-types";

type ErrorResponse = { error?: string; code?: string; requestId?: string; retryAfterSeconds?: number; stage?: string };
type PackageResponse = ErrorResponse & { package?: TeachingPackage; renderGrant?: string };

async function responseJson<T extends ErrorResponse>(response: Response, interrupted: string): Promise<T> {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(interrupted);
  }
}

export async function readPackageResponse(response: Response, fallback: string): Promise<{ package: TeachingPackage; renderGrant: string }> {
  const payload = await responseJson<PackageResponse>(response, "サーバーからの応答が途中で終了しました。少し待ってもう一度お試しください。");
  if (!response.ok || !payload.package || !payload.renderGrant) throw new Error(payload.error || fallback);
  return { package: payload.package, renderGrant: payload.renderGrant };
}

export async function readRenderedSlideResponse(response: Response): Promise<RenderedSlideImage> {
  const payload = await responseJson<ErrorResponse & { image?: RenderedSlideImage }>(response, "画像生成サーバーの応答を読み取れませんでした。時間を置いてもう一度お試しください。");
  if (!response.ok || !payload.image) {
    const trace = [payload.stage ? `段階: ${payload.stage}` : "", payload.requestId ? `識別ID: ${payload.requestId}` : ""].filter(Boolean).join("、");
    throw new Error(`${payload.error || "スライド画像を生成できませんでした。"}${trace ? `（${trace}）` : ""}`);
  }
  return payload.image;
}
