import { badRequest, conflict, PublicHttpError, routeUnavailable } from "./http-errors";

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

function required(env: Env, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} が設定されていません。`);
  return value;
}

function controlPlaneConfig(env: Env) {
  const url = required(env, "KYOZAI_CONTROL_PLANE_URL");
  if (!/^https:\/\//.test(url)) throw new Error("KYOZAI_CONTROL_PLANE_URL はHTTPS URLで指定してください。");
  return { baseUrl: `${url.replace(/\/$/, "")}/internal/v1`, token: required(env, "KYOZAI_CONTROL_PLANE_TOKEN") };
}

function responseError(response: Response): never {
  if (response.status === 404) throw routeUnavailable();
  if (response.status === 409) throw conflict("このjobは現在の状態では操作できません。");
  if (response.status === 400) throw badRequest("job要求を確認してください。");
  throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "教材jobの保存先を利用できません。", 60);
}

/** Server-only gateway. Browser code never receives the control-plane token. */
export async function sendControlPlaneCommand<T>(resource: "jobs" | "dispatches" | "stages" | "artifacts", command: Record<string, unknown>, env: Env = process.env, fetcher: Fetcher = fetch): Promise<T> {
  const config = controlPlaneConfig(env);
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl}/${resource}/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(command), cache: "no-store",
    });
  } catch {
    throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "教材jobの保存先に接続できません。", 60);
  }
  if (response.ok) return await response.json() as T;
  return responseError(response);
}

export async function sendControlPlaneJobCommand<T>(command: Record<string, unknown>, env: Env = process.env, fetcher: Fetcher = fetch): Promise<T> {
  return sendControlPlaneCommand("jobs", command, env, fetcher);
}

export function cloudflareStateEnabled(env: Env = process.env) {
  return env.KYOZAI_CLOUDFLARE_STATE_ENABLED === "1";
}

/** Server-only R2 stream boundary. Its URL and bearer token never reach a browser. */
export async function putControlPlaneArtifactBytes(artifactId: string, bytes: BodyInit | Uint8Array, mediaType: string, env: Env = process.env, fetcher: Fetcher = fetch) {
  const config = controlPlaneConfig(env);
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl}/artifacts/${encodeURIComponent(artifactId)}/bytes`, {
      method: "PUT", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": mediaType, "Cache-Control": "no-store" }, body: bytes instanceof Uint8Array ? new Blob([Uint8Array.from(bytes)]) : bytes, cache: "no-store",
    });
  } catch {
    throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "教材artifactの保存先に接続できません。", 60);
  }
  if (!response.ok) return responseError(response);
  return await response.json() as { artifactId: string; byteSize: number };
}

export async function getControlPlaneArtifactBytes(artifactId: string, env: Env = process.env, fetcher: Fetcher = fetch) {
  const config = controlPlaneConfig(env);
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl}/artifacts/${encodeURIComponent(artifactId)}/bytes`, {
      headers: { Authorization: `Bearer ${config.token}`, "Cache-Control": "no-store" }, cache: "no-store",
    });
  } catch {
    throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "教材artifactの保存先に接続できません。", 60);
  }
  if (!response.ok) return responseError(response);
  return Buffer.from(await response.arrayBuffer());
}
