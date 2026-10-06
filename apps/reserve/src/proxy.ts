import { NextResponse, type NextRequest } from "next/server";

/**
 * 試作段階のアクセス制限（Basic認証）。
 * 本番の認証（パスキー＋二段階認証、端末登録）を作るまでのつなぎ。
 *
 * - STAFF_BASIC_AUTH="ユーザー名:パスワード" が設定されていれば全画面・全APIに認証を要求する
 * - 本番ビルド（NODE_ENV=production）で未設定なら、誤公開を防ぐため全リクエストを拒否する
 * - 外部連携API（/api/v1/integration/*）は別のトークン認証を使うので対象外
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/v1/integration/")) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/v1/") && crossSiteWrite(request)) {
    return NextResponse.json({ error: "forbidden", message: "この操作は受け付けられません" }, { status: 403 });
  }

  const expected = process.env.STAFF_BASIC_AUTH;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("STAFF_BASIC_AUTH が未設定のため停止しています", { status: 503 });
    }
    return NextResponse.next();
  }

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    if (constantTimeEqual(decoded, expected)) return NextResponse.next();
  }
  return new NextResponse("認証が必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="reserve", charset="UTF-8"' },
  });
}

/**
 * 変更の操作（GET 以外）が、ほかのサイト・ほかのページから送られてきたものか（CSRF の多重防御。PHP 版と同じ決まり）。
 * ブラウザが付ける Origin・Sec-Fetch-Site で見分け、付いていなければ通す
 */
function crossSiteWrite(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const origin = request.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      return true;
    }
    if (host !== request.headers.get("host")) return true;
  }
  const site = request.headers.get("sec-fetch-site");
  return !!site && site !== "same-origin" && site !== "none";
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg).*)"],
};
