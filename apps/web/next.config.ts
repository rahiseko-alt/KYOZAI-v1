import type { NextConfig } from "next";
import path from "node:path";

// セキュリティヘッダは proxy.ts（lib/security/headers.ts）が1箇所で組み立てて付ける
// （AGENTS.md「結合を増やさない」1）。ここには重ねて書かない。
const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "../..") },
  outputFileTracingIncludes: {
    "/api/render-slide": [
      "node_modules/sharp/**/*",
      "node_modules/@img/sharp-linux-x64/**/*",
      "node_modules/@img/sharp-libvips-linux-x64/**/*",
      "node_modules/.pnpm/sharp@*/node_modules/sharp/**/*",
      "node_modules/.pnpm/@img+sharp-linux-x64@*/node_modules/@img/sharp-linux-x64/**/*",
      "node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/**/*",
      "../../node_modules/.pnpm/sharp@*/node_modules/sharp/**/*",
      "../../node_modules/.pnpm/@img+sharp-linux-x64@*/node_modules/@img/sharp-linux-x64/**/*",
      "../../node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },
};

export default nextConfig;
