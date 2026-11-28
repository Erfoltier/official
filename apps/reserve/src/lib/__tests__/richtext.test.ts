import { describe, expect, it } from "vitest";
import { isRich, normalizeRich, parseRich, richToPlain, serializeRich } from "@/lib/domain/richtext";

describe("メモの文字装飾", () => {
  it("ただの文字はそのまま読めて、そのまま保存される（昔のメモと互換）", () => {
    expect(parseRich("1行目\n2行目")).toEqual([[{ t: "1行目" }], [{ t: "2行目" }]]);
    expect(serializeRich(parseRich("1行目\n\n3行目"))).toBe("1行目\n\n3行目");
    expect(isRich("3<5 の確認")).toBe(false);
    expect(parseRich("3<5 の確認")).toEqual([[{ t: "3<5 の確認" }]]);
  });

  it("太字・斜体・下線・文字色を決まった形で保存し、読み戻せる", () => {
    const html = serializeRich([[{ t: "注意：" , b: true, c: "#DC2626" }, { t: "麻酔", u: true }, { t: "あり" }], [], [{ t: "斜体", i: true }]]);
    expect(html).toBe('<p><span style="color:#dc2626"><b>注意：</b></span><u>麻酔</u>あり</p><p><br></p><p><i>斜体</i></p>');
    expect(parseRich(html)).toEqual([[{ t: "注意：", b: true, c: "#dc2626" }, { t: "麻酔", u: true }, { t: "あり" }], [], [{ t: "斜体", i: true }]]);
    expect(richToPlain(html)).toBe("注意：麻酔あり\n\n斜体");
  });

  it("ブラウザが出す色々な書き方（span の style・font・div・strong）をそろえる", () => {
    const fromEditor =
      '<div><span style="font-weight: bold; color: rgb(220, 38, 38);">赤太字</span></div><div><font color="#2563eb">青</font><br></div><div><strong>強調</strong> と <em>斜め</em></div>';
    expect(normalizeRich(fromEditor)).toBe(
      '<p><span style="color:#dc2626"><b>赤太字</b></span></p><p><span style="color:#2563eb">青</span></p><p><b>強調</b> と <i>斜め</i></p>',
    );
  });

  it("危ないタグ・属性は捨て、文字は必ずエスケープする", () => {
    const evil = '<p onclick="alert(1)">a<script>alert(2)</script><img src=x onerror=alert(3)><span style="color:expression(alert(4));background:url(x)">b</span><a href="javascript:alert(5)">c</a></p>';
    const out = normalizeRich(evil);
    expect(out).toBe("abc");
    expect(normalizeRich('<b>&lt;script&gt;x</b>')).toBe("<p><b>&lt;script&gt;x</b></p>");
    // 先頭がタグに見えるただの文字は、装飾つきの形（エスケープ済み）で保存して読み違えない
    const tricky = serializeRich([[{ t: "<b>太字ではない" }]]);
    expect(tricky).toBe("<p>&lt;b&gt;太字ではない</p>");
    expect(richToPlain(tricky)).toBe("<b>太字ではない");
  });

  it("標準の文字色は色なしとして扱う", () => {
    expect(normalizeRich('<p><span style="color:#241f30">標準</span></p>')).toBe("標準");
  });
});
