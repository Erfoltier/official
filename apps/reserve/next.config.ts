import type { NextConfig } from "next";

/**
 * 2つの作り方がある。
 * - 通常：Node.js のサーバーとして動かす（npm run dev / build / start）
 * - BUILD_TARGET=static：画面だけを静的ファイルに書き出す（ロリポップ等のPHPサーバー向け。APIはphp/が担当）
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
      // route.ts（API）と proxy.ts は書き出さない（PHP側が担当する）
      pageExtensions: ["tsx"],
      images: { unoptimized: true },
      poweredByHeader: false,
    }
  : {
      poweredByHeader: false,
      // 開発時に 127.0.0.1 で開いても画面の部品を読めるようにする
      allowedDevOrigins: ["127.0.0.1"],
      // 開発時（npm run dev）は API を PHP 版へ回す（本番と同じ API で確かめる）
      async rewrites() {
        const api = process.env.RESERVE_PHP_API;
        return api ? { beforeFiles: [{ source: "/api/:path*", destination: `${api}/api/:path*` }], afterFiles: [], fallback: [] } : { beforeFiles: [], afterFiles: [], fallback: [] };
      },
      async headers() {
        return [
          { source: "/:path*", headers: securityHeaders },
          { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
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
