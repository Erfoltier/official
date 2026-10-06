import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BOOT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "予約カレンダー",
  description: "美容皮膚科向け予約管理（試作）",
  robots: { index: false, follow: false },
  applicationName: "予約カレンダー",
  appleWebApp: { capable: true, title: "予約", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // ページ全体のピンチ拡大は止め、時間軸だけを指で拡大縮小させる
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* 院の配色を、画面が描かれる前に当てる（中身は決まった文字列だけ） */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
