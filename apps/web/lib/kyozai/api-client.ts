import type { TeachingPackage } from "./types";
import type { RevisionMetadata } from "./revision";

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

type RevisionResponse = { package?: TeachingPackage; revision?: RevisionMetadata; error?: string };

export async function readRevisionResponse(response: Response, fallback: string): Promise<{ package: TeachingPackage; revision: RevisionMetadata }> {
  let payload: RevisionResponse;
  try {
    payload = (await response.json()) as RevisionResponse;
  } catch {
    throw new Error("サーバーからの応答が途中で終了しました。元の教材は維持されています。");
  }
  if (!response.ok || !payload.package || payload.revision?.status !== "promoted") throw new Error(payload.error || fallback);
  return { package: payload.package, revision: payload.revision };
}
