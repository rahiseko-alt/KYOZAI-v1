import type { TeachingPackage } from "./types";
import type { RenderedSlideImage } from "./image-types";

type PackageResponse = { package?: TeachingPackage; renderGrant?: string; error?: string };

export async function readPackageResponse(response: Response, fallback: string): Promise<{ package: TeachingPackage; renderGrant: string }> {
  let payload: PackageResponse;
  try {
    payload = (await response.json()) as PackageResponse;
  } catch {
    throw new Error("サーバーからの応答が途中で終了しました。少し待ってもう一度お試しください。");
  }
  if (!response.ok || !payload.package || !payload.renderGrant) throw new Error(payload.error || fallback);
  return { package: payload.package, renderGrant: payload.renderGrant };
}

export async function readRenderedSlideResponse(response: Response): Promise<RenderedSlideImage> {
  let payload: { image?: RenderedSlideImage; error?: string };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error("画像生成の応答が途中で終了しました。もう一度お試しください。");
  }
  if (!response.ok || !payload.image) throw new Error(payload.error || "スライド画像を生成できませんでした。");
  return payload.image;
}
