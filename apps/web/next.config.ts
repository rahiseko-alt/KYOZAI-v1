import type { NextConfig } from "next";

// セキュリティヘッダは proxy.ts（lib/security/headers.ts）が1箇所で組み立てて付ける
// （AGENTS.md「結合を増やさない」1）。ここには重ねて書かない。
const nextConfig: NextConfig = {};

export default nextConfig;
