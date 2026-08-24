import { NextResponse } from "next/server";

// 起動確認用。認証やDBに触らず、プロセスが応答できることだけを外部事実で示す。
// scripts/smoke.sh と（公開後に足す）presets/prod-smoke.yml がこの経路の 200 を検査する。
export async function GET() {
  return NextResponse.json({
    status: "ok",
    environment: process.env.VERCEL_ENV || "local",
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.KYOZAI_DEPLOY_COMMIT_SHA || "local",
  });
}
