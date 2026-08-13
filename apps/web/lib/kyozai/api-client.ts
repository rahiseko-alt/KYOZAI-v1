import type { TeachingPackage } from "./types";

type PackageResponse = { package?: TeachingPackage; error?: string };

export async function readPackageResponse(response: Response, fallback: string): Promise<TeachingPackage> {
  let payload: PackageResponse;
  try {
    payload = (await response.json()) as PackageResponse;
  } catch {
    throw new Error("サーバーからの応答が途中で終了しました。少し待ってもう一度お試しください。");
  }
  if (!response.ok || !payload.package) throw new Error(payload.error || fallback);
  return payload.package;
}
