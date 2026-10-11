import { describe, expect, it } from "vitest";
import { isSignLine, paraText, parseDocHtml, toWareki, type Para } from "@/lib/domain/docHtml";

// Google ドキュメントの「ウェブページ（HTML）」書き出しと同じ形
const GDOC = `<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type"><style type="text/css">@import url(https://themes.googleusercontent.com/fonts/css?kit=x);ol{margin:0;padding:0}table td,table th{padding:0}.c3{color:#000000;font-weight:700;text-decoration:none;vertical-align:baseline;font-size:16pt;font-family:"Arial";font-style:normal}.c0{color:#000000;font-weight:400;text-decoration:none;vertical-align:baseline;font-size:11pt;font-family:"Arial";font-style:normal}.c5{color:#ff0000;font-weight:700;text-decoration:underline;font-size:11pt}.c2{padding-top:0pt;padding-bottom:0pt;line-height:1.15;orphans:2;widows:2;text-align:center}.c1{padding-top:0pt;padding-bottom:0pt;line-height:1.15;orphans:2;widows:2;text-align:left;height:11pt}.c8{background-color:#ffffff;max-width:451.4pt;padding:72pt 72pt 72pt 72pt}.lst-kix_a-0>li:before{content:"\\0025cf  "}</style></head><body class="c8 doc-content"><p class="c2"><span class="c3">ボトックス注射　施術同意書</span></p><p class="c1"><span class="c0"></span></p><p class="c1"><span class="c0">効果には&nbsp;個人差があります。</span><span class="c5">注入後2-3日は入浴を避けて下さい。</span></p><ul class="c4 lst-kix_a-0 start"><li class="c1 li-bullet-0"><span class="c0">妊娠中の方</span></li><li class="c1 li-bullet-0"><span class="c0">授乳中の方</span></li></ul><table class="c9"><tr class="c7"><td class="c6" colspan="1" rowspan="1"><p class="c1"><span class="c0">部位</span></p></td><td class="c6"><p class="c1"><span class="c0">眉間</span></p></td></tr></table><p class="c1"><span class="c0">令和　　&nbsp; 年 &nbsp; &nbsp;月 &nbsp; &nbsp; 日 &nbsp; &nbsp; &nbsp; 患者氏名 &nbsp;</span></p><p class="c1"><img alt="" src="https://lh7-us.googleusercontent.com/x" style="width: 10px"><a href="javascript:alert(1)" onclick="alert(2)"><span class="c0">いしだ皮フ科/美容皮膚科</span></a></p><script>alert(3)</script></body></html>`;

describe("同意書のひな形（Google ドキュメントの HTML）", () => {
  it("見出し・太字・下線・色・中央寄せ・箇条書き・表を読み、危ないものは捨てる", () => {
    const blocks = parseDocHtml(GDOC);
    const title = blocks[0] as Para;
    expect(title).toMatchObject({ kind: "p", align: "center", size: "l" });
    expect(title.runs).toEqual([{ t: "ボトックス注射　施術同意書", b: true, f: "Arial" }]);
    const body = blocks.find((b) => b.kind === "p" && paraText(b).startsWith("効果")) as Para;
    expect(body.runs).toEqual([
      { t: "効果には\u00a0個人差があります。", f: "Arial" },
      { t: "注入後2-3日は入浴を避けて下さい。", b: true, u: true, c: "#ff0000" },
    ]);
    const lis = blocks.filter((b) => b.kind === "p" && b.list === "ul");
    expect(lis.map((b) => paraText(b as Para))).toEqual(["妊娠中の方", "授乳中の方"]);
    const table = blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => r.map((c) => c.map(paraText).join("")))).toEqual([["部位", "眉間"]]);
    const sign = blocks.filter((b) => b.kind === "p" && isSignLine(b));
    expect(sign).toHaveLength(1);
    const all = JSON.stringify(blocks);
    expect(all).not.toContain("alert");
    expect(all).not.toContain("googleusercontent");
    expect(paraText(blocks[blocks.length - 1] as Para)).toBe("いしだ皮フ科/美容皮膚科");
  });

  it("和暦にする", () => {
    expect(toWareki("2026-10-05")).toBe("令和8年10月5日");
    expect(toWareki("2019-05-01")).toBe("令和元年5月1日");
  });
});

describe("Googleドキュメントの配置", () => {
  it("ページの余白・文字の大きさ・行間・段落の間隔を読む", async () => {
    const { docPageMargins, parseDocHtml } = await import("../domain/docHtml");
    const html =
      '<html><head><style>.c1{padding-top:0pt;padding-bottom:6pt;line-height:1.15;text-align:left}.c2{font-size:11pt}.c9{background-color:#ffffff;max-width:451.4pt;padding:72pt 72pt 72pt 72pt}</style></head>' +
      '<body class="c9 doc-content"><p class="c1"><span class="c2">本文</span></p><p style="padding:0;line-height:150%"><span style="font-size:16px">二行目</span></p></body></html>';
    expect(docPageMargins(html)).toEqual([72, 72, 72, 72]);
    const [a, b] = parseDocHtml(html);
    expect(a).toMatchObject({ pt: 11, lh: 1.15, after: 6 });
    expect(a).not.toHaveProperty("before");
    expect(b).toMatchObject({ pt: 12, lh: 1.5 });
    expect(docPageMargins("<html><body><p>x</p></body></html>")).toBeNull();
  });
});
