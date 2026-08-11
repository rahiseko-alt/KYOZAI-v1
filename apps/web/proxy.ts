import { NextResponse, type NextRequest } from "next/server";

import {
  buildContentSecurityPolicy,
  buildStaticSecurityHeaders,
  createNonce,
} from "./lib/security/headers";

/**
 * 画面の応答すべてを通す。CSP をリクエストごとの nonce 付きで付けるため、静的ファイルを
 * 除く全ルートに掛ける。ログインが要る範囲を作るときは、ここに判定を1箇所追加する。
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce);

  // Next.js は受け取ったリクエストヘッダの nonce を、自分が差し込むスクリプトに付ける。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  for (const header of buildStaticSecurityHeaders()) {
    response.headers.set(header.key, header.value);
  }
  return response;
}
