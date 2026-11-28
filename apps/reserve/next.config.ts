import type { NextConfig } from "next";

/**
 * API は PHP 版（php/）だけ。画面の作り方は2つ。
 * - 通常：開発用（npm run dev）。/api/* は RESERVE_PHP_API（php -S）へ回す
 * - BUILD_TARGET=static：画面だけを静的ファイルに書き出す（本番。ロリポップ等のPHPサーバーに php/ と一緒に置く）
 *   NEXT_PUBLIC_BASE_PATH=/reserve のように置き場所を指定する
 */
const isStatic = process.env.BUILD_TARGET === "static";
const isDev = process.env.NODE_ENV !== "production";

/** 患者情報を扱う画面なので、外部への読み込み・埋め込み・キャッシュを最小限にする */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = isStatic
  ? {
      output: "export",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
      trailingSlash: true,
      images: { unoptimized: true },
      poweredByHeader: false,
    }
  : {
      poweredByHeader: false,
      // 開発時に 127.0.0.1 で開いても画面の部品を読めるようにする
      allowedDevOrigins: ["127.0.0.1"],
      // API は PHP 版へ回す（本番と同じ API で確かめる。応答の Cache-Control: no-store は PHP 側が付ける）
      async rewrites() {
        const api = process.env.RESERVE_PHP_API;
        return api ? { beforeFiles: [{ source: "/api/:path*", destination: `${api}/api/:path*` }], afterFiles: [], fallback: [] } : { beforeFiles: [], afterFiles: [], fallback: [] };
      },
      async headers() {
        return [
          { source: "/:path*", headers: securityHeaders },
          // 操作マニュアルだけは設定画面に埋め込む（患者情報なし・書体は Google Fonts）
          {
            source: "/manual/:path*",
            headers: [
              { key: "X-Frame-Options", value: "SAMEORIGIN" },
              {
                key: "Content-Security-Policy",
                value:
                  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
              },
            ],
          },
        ];
      },
    };

export default nextConfig;
