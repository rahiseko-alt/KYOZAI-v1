import type { NextConfig } from "next";
import path from "node:path";

// セキュリティヘッダは proxy.ts（lib/security/headers.ts）が1箇所で組み立てて付ける
// （AGENTS.md「結合を増やさない」1）。ここには重ねて書かない。
const nextConfig: NextConfig = {
  turbopack: { root: process.env.VERCEL ? __dirname : path.resolve(__dirname, "../..") },
};

export default nextConfig;
