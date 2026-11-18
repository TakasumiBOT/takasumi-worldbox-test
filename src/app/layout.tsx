import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAKASUMI WORLD BOX",
  description: "みんなで同じワールドを歩き回れる、見下ろし型の共有ワールドゲーム",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
