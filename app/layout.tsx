import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// 移行版の最小ルートレイアウト。本家 web のサイトクローム（SiteNav 等）は
// WORLD BOX の独立シェルには不要なので付けない。globals.css は本家と同一で、
// WORLD BOX 用の上書き（body:has(...) 等）もそのまま入っている。
export const metadata: Metadata = {
  title: "WORLD BOX",
  description: "AGO WORLD BOX の移行テスト版（Vercel）",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
