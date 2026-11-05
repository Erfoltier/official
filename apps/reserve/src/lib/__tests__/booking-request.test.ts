import { describe, expect, it } from "vitest";
import { parseBookingRequest } from "@/lib/domain/bookingRequest";

const SAMPLE = `【美容皮膚科・初診予約申請】

受診区分：①初診
希望予約日時：2026年12月28日（月）
希望時間帯：午前

漢字氏名：試験太郎
カナ氏名：シケンタロウ
生年月日：2000年12月3日
性別：女性
電話番号：09012345678
いしだ皮フ科保険通院歴：無

当日施術希望：無
希望治療メニューまたはお悩み：ニキビ･ホクロ
具体的な部位・個数：記載なし
その他ご相談事項：なし
紹介者名：なし

予約申請ID：R2026100506574020A34A8B`;

describe("LINE予約申請の読み取り", () => {
  it("いしだ皮フ科のフォームの文面", () => {
    const r = parseBookingRequest(SAMPLE);
    expect(r.requestId).toBe("R2026100506574020A34A8B");
    expect(r.name).toBe("試験太郎");
    expect(r.kana).toBe("シケンタロウ");
    expect(r.birthDate).toBe("2000-12-03");
    expect(r.phone).toBe("09012345678");
    expect(r.gender).toBe("女性");
    expect(r.desiredDate).toBe("2026-12-28");
    expect(r.desiredTime).toBe("午前");
    expect(r.visitType).toBe("①初診");
    // 「なし」「記載なし」はメモに入れない
    expect(r.memo).toBe(
      [
        "LINE予約申請／希望：2026年12月28日（月） 午前",
        "受診区分：①初診",
        "性別：女性",
        "保険通院歴：無",
        "当日施術希望：無",
        "希望・お悩み：ニキビ･ホクロ",
      ].join("\n"),
    );
  });

  it("半角コロン・全角数字・ハイフン付き電話でも読める。形の違うIDは無視", () => {
    const r = parseBookingRequest("予約申請ID: R-2026 1005\n電話番号：０９０－１２３４－５６７８\n生年月日: 1990/2/30");
    expect(r.requestId).toBe("R-20261005");
    expect(r.phone).toBe("09012345678");
    expect(r.birthDate).toBeUndefined(); // 2月30日は存在しない
    expect(parseBookingRequest("予約申請ID：R2026<script>").requestId).toBeUndefined();
  });
});

describe("複数行の希望メニュー・相談内容", () => {
  const MULTI = `【美容皮膚科・初診予約申請】

受診区分：①初診
希望予約日時：2026年12月28日（月）
希望時間帯：午後

漢字氏名：試験花子
カナ氏名：シケンハナコ
生年月日：1990年1月2日
電話番号：09011112222
いしだ皮フ科保険通院歴：有

当日施術希望：有
希望治療メニューまたはお悩み：シミ取りレーザー
ニキビ跡
ほくろ除去：2個
具体的な部位・個数：両頬
額

その他ご相談事項：麻酔クリームではなく麻酔の注射を希望します。

前回は赤みが3日ほど続きました。
紹介者名：なし

予約申請ID：R2026100506574020A34A8C`;

  it("2行目以降も省略せずにメモへ入れ、ほかの項目は正しく読む", () => {
    const r = parseBookingRequest(MULTI);
    expect(r.requestId).toBe("R2026100506574020A34A8C");
    expect(r.name).toBe("試験花子");
    expect(r.phone).toBe("09011112222");
    expect(r.memo).toBe(
      [
        "LINE予約申請／希望：2026年12月28日（月） 午後",
        "受診区分：①初診",
        "保険通院歴：有",
        "当日施術希望：有",
        "希望・お悩み：シミ取りレーザー\nニキビ跡\nほくろ除去：2個",
        "部位・個数：両頬\n額",
        "相談：麻酔クリームではなく麻酔の注射を希望します。\n前回は赤みが3日ほど続きました。",
      ].join("\n"),
    );
  });

  it("入力欄いっぱい（希望500字・相談1000字）でも途中で切れない", () => {
    const wish = "あ".repeat(500);
    const note = "い".repeat(1000);
    const r = parseBookingRequest(`希望治療メニューまたはお悩み：${wish}\nその他ご相談事項：${note}`);
    expect(r.memo).toContain(wish);
    expect(r.memo).toContain(note);
  });
});
