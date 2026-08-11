// セキュリティヘッダの組み立て。値をここ1箇所で作り、proxy.ts が応答に付ける
// （AGENTS.md「結合を増やさない」1・2）。

/** リクエストごとに使い捨てる nonce を作る。 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * CSP の値を作る。
 *
 * script-src に 'unsafe-inline' を入れない。Next.js が差し込む起動用スクリプトには
 * この nonce が付く。'strict-dynamic' を併記しているので、nonce を持つスクリプトが
 * 読み込む先も許可される。
 *
 * style-src だけは 'unsafe-inline' を許している。Next.js が最初の描画をちらつかせない
 * ために style 属性を使うため。スタイルの注入は script の注入より被害が小さい。
 *
 * 開発時（`pnpm dev`）だけ 'unsafe-eval' を許す。React が開発時に、ブラウザ上で
 * サーバ側のエラースタックを再構築するため eval を使うという Next.js 公式の仕様
 * （本番ビルドでは React も Next.js も eval を使わない）。本番の値はこれで変わらない。
 */
export function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // クリックジャッキング対策。X-Frame-Options と同じ意図を CSP でも書く
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];

  return directives.join("; ");
}

/**
 * CSP 以外の固定セキュリティヘッダ。nonce に依存しないのでリクエストをまたいで同じ値。
 * prod-smoke（presets/prod-smoke.yml）が本番でこの HSTS ヘッダの有無を外部事実として検査する。
 */
export function buildStaticSecurityHeaders(): Array<{ key: string; value: string }> {
  return [
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ];
}
