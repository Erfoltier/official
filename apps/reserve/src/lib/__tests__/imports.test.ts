import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { decodeText, docxToHtml, parseCsv, parseXlsx } from "../domain/importFiles";
import { MENU_TEMPLATE, PRICE_TEMPLATE, PRODUCT_TEMPLATE, menuRowsFromTable, priceRowsFromTable } from "../domain/importMap";
import { parseDocHtml, paraText } from "../domain/docHtml";
import type { Lane } from "../domain/types";

const lanes: Lane[] = [
  { id: "lane-main", name: "メインレーン（医師）", shortName: "メイン(医師)", order: 0, active: true },
  { id: "lane-1", name: "1番レーン", shortName: "1番", order: 1, active: true },
  { id: "lane-3", name: "3番レーン", shortName: "3番", order: 2, active: true },
];

describe("取り込み：ファイルを読む", () => {
  it("CSV（クォート・改行入り・BOM）とShift_JIS", () => {
    expect(parseCsv('﻿a,"b,c","d\n""e"""\r\n,,\r\nx,y,z')).toEqual([
      ["a", "b,c", 'd\n"e"'],
      ["x", "y", "z"],
    ]);
    expect(parseCsv("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    // 「料金」を Shift_JIS で
    expect(decodeText(new Uint8Array([0x97, 0xbf, 0x8b, 0xe0]))).toBe("料金");
  });

  it("Excel（.xlsx）の最初のシート", () => {
    const xlsx = zipSync({
      "xl/sharedStrings.xml": strToU8('<sst><si><t>分類</t></si><si><t>項目名</t></si><si><r><t>シミ</t></r><r><t>取り</t></r></si><si><t>A&amp;B</t></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>料金</t></is></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>11000</v></c></row><row r="3"><c r="B3" t="s"><v>3</v></c></row></sheetData></worksheet>',
      ),
    });
    expect(parseXlsx(xlsx)).toEqual([
      ["分類", "項目名", "料金"],
      ["シミ取り", "", "11000"],
      ["", "A&B"],
    ]);
  });

  it("Word（.docx）を同意書として読める HTML にする", () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        '<w:document><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>施術同意書</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">注意 &lt;重要&gt;</w:t></w:r></w:p>' +
          "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>氏名</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>" +
          "<w:p><w:r><w:t>令和　年　月　日　患者氏名</w:t></w:r></w:p></w:body></w:document>",
      ),
    });
    const blocks = parseDocHtml(docxToHtml(docx));
    expect(blocks[0]).toMatchObject({ kind: "p", align: "center", size: "xl", runs: [{ t: "施術同意書", b: true }] });
    expect(blocks[1]).toMatchObject({ runs: [{ t: "注意 <重要>", c: "#ff0000" }] });
    expect(blocks[2].kind).toBe("table");
    expect(blocks[3].kind === "p" && paraText(blocks[3])).toBe("令和　年　月　日　患者氏名");
  });
});

describe("取り込み：表をメニュー・料金に直す", () => {
  it("ひな形のメニューを読める（固定・幅あり・レーン・すべて）", () => {
    const rows = menuRowsFromTable(MENU_TEMPLATE, lanes);
    expect(Array.isArray(rows)).toBe(true);
    const r = rows as Exclude<typeof rows, { error: string }>;
    expect(r[0].input).toMatchObject({ name: "ボトックス 額", abbr: "BTX額", duration: { kind: "fixed", minutes: 15 }, laneIds: ["lane-main"], priceYen: 22000, color: "#8b5cf6" });
    expect(r[1].input).toMatchObject({ duration: { kind: "range", min: 30, max: 90, step: 5 }, defaultMinutes: 45, laneIds: ["lane-1", "lane-3"], priceYen: null });
    expect(r[2].input).toMatchObject({ laneIds: [], priceYen: 0, active: true });
  });

  it("おかしい行は理由つきで止める", () => {
    const rows = menuRowsFromTable(
      [
        ["メニュー名", "時間", "レーン", "料金"],
        ["A", "", "", ""],
        ["B", "15", "5番", ""],
        ["C", "15", "", "高い"],
      ],
      lanes,
    ) as { error?: string }[];
    expect(rows.map((x) => x.error)).toEqual(["時間（分）がありません", "レーン「5番」が見つかりません", "料金が数字ではありません"]);
    expect(menuRowsFromTable([["a", "b"]], lanes)).toEqual({ error: expect.stringContaining("見出し") });
  });

  it("自費商品の書式は種類の列がなくてもすべて商品、種類の言葉がおかしい行は止める", () => {
    const rows = priceRowsFromTable(PRODUCT_TEMPLATE, "product") as { item?: { kind: string; category: string } }[];
    expect(rows.map((x) => [x.item?.category, x.item?.kind])).toEqual([
      ["ゼオスキンヘルス", "product"],
      ["内服", "product"],
      ["外用", "product"],
    ]);
    const bad = priceRowsFromTable([
      ["種類", "分類", "項目名", "料金"],
      ["なにか", "A", "B", "100"],
      ["", "日焼け止め", "C", "100"],
    ]) as { error?: string; item?: { kind: string } }[];
    expect(bad[0].error).toContain("種類");
    expect(bad[1].item?.kind).toBe("treatment");
  });

  it("料金表：分類が空なら上の行と同じ、値段なしは表示の文字", () => {
    const rows = priceRowsFromTable(PRICE_TEMPLATE) as { item?: object }[];
    expect(rows.map((x) => x.item)).toEqual([
      { category: "シミ取り", name: "Qスイッチルビーレーザー 〜10mm", priceYen: 11000, kind: "treatment" },
      { category: "シミ取り", name: "顔まとめ取り", priceYen: null, priceText: "要相談", kind: "treatment" },
      { category: "スキンケア", name: "日焼け止め SPF50", priceYen: 3300, kind: "product" },
    ]);
    const r2 = priceRowsFromTable([
      ["分類", "項目名", "料金"],
      ["シミ", "A", "1,100円"],
      ["", "B", "２２００"],
    ]) as { item?: { category: string; priceYen: number | null } }[];
    expect(r2.map((x) => [x.item?.category, x.item?.priceYen])).toEqual([
      ["シミ", 1100],
      ["シミ", 2200],
    ]);
  });
});
