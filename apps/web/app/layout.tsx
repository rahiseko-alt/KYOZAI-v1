import type { Metadata } from "next";

import "./globals.css";

// CSP の nonce（proxy.ts が組み立てる）は動的にレンダリングされたページにしか
// 届かない。ここで静的化を止めておかないと、動くページが増えるまで気付かないまま
// nonce が届かない状態になる（docs/failures.md「完了報告した直後に、外部レビューと
// 独立検証で実害のある欠陥3件が見つかった」と同じ形の欠陥）。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Template",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
