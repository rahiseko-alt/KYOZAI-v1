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
  return { url: `${url.replace(/\/$/, "")}/internal/v1/jobs/commands`, token: required(env, "KYOZAI_CONTROL_PLANE_TOKEN") };
}

/** Server-only gateway. Browser code never receives the control-plane token. */
export async function sendControlPlaneJobCommand<T>(command: Record<string, unknown>, env: Env = process.env, fetcher: Fetcher = fetch): Promise<T> {
  const config = controlPlaneConfig(env);
  let response: Response;
  try {
    response = await fetcher(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(command), cache: "no-store",
    });
  } catch {
    throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "教材jobの保存先に接続できません。", 60);
  }
  if (response.ok) return await response.json() as T;
  if (response.status === 404) throw routeUnavailable();
  if (response.status === 409) throw conflict("このjobは現在の状態では操作できません。");
  if (response.status === 400) throw badRequest("job要求を確認してください。");
  throw new PublicHttpError(503, "SERVICE_UNAVAILABLE", "教材jobの保存先を利用できません。", 60);
}
