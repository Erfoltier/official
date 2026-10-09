import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BOOT } from "@/lib/theme";
import { DialogBackdropClose } from "@/components/DialogBackdropClose";

export const metadata: Metadata = {
  title: { default: "LANE RESERVE", template: "%s｜LANE RESERVE" },
  description: "LANE RESERVE（レーンリザーブ）— レーンで見る予約台帳",
  robots: { index: false, follow: false },
  applicationName: "LANE RESERVE",
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "LANE RESERVE", statusBarStyle: "default" },
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
      <body>
        {children}
        <DialogBackdropClose />
      </body>
    </html>
  );
}
