"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ConsentTemplate, Lane, Menu } from "@/lib/domain/types";
import {
  deleteConsentTemplate,
  fetchConsentTemplates,
  importConsentTemplates,
  importFetch,
  importPrices,
  saveMenu,
} from "@/components/calendar/api";
import { decodeText, docxToHtml, parseCsv, parseXlsx, toCsv, type Table } from "@/lib/domain/importFiles";
import { MENU_TEMPLATE, PRICE_TEMPLATE, PRODUCT_TEMPLATE, menuRowsFromTable, priceRowsFromTable, type MenuImportRow, type PriceImportRow } from "@/lib/domain/importMap";
import { IMPORT_SHEET_PREFIX } from "@/lib/domain/estimateDiscount";
import { searchKey } from "@/lib/domain/text";
import { invalidateConsentTemplates } from "@/components/consents/consentCache";
import styles from "./settings.module.css";

interface Props {
  menus: Menu[];
  lanes: Lane[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (t: string) => void;
  fail: (e: unknown) => void;
  /** 取り込みの各欄のあと（Google 連携の説明の前）に出す追加の欄 */
  extra?: ReactNode;
}

/** ファイル（CSV・Excel）を表にする */
async function readTable(file: File): Promise<Table> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(bytes);
  if (/\.xls$/i.test(file.name)) throw new Error("古い Excel 形式（.xls）は読み込めません。.xlsx か CSV で保存し直してください");
  return parseCsv(decodeText(bytes));
}

function download(name: string, rows: string[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "読み込みできませんでした");

/**
 * 取り込み：メニュー・料金表・同意書を、決まった書式のファイル（CSV・Excel・Word）や
 * Googleスプレッドシート／ドキュメントの共有リンクから入れる。読む前に中身を見せて、確かめてから取り込む
 */
export function ImportsTab(props: Props) {
  if (!props.canEdit) return <p className={styles.lead}>取り込みは、管理操作を許可されたスタッフのみ利用できます。</p>;
  return (
    <section>
      <p className={styles.lead}>
        ほかのソフトや表で作成したメニュー・料金表・同意書を、まとめて取り込めます。
        <b>CSV・Excel（.xlsx）・Word（.docx）</b>のファイル、または<b>Google スプレッドシート／ドキュメントの共有リンク</b>（共有設定は「リンクを知っている全員」）から読み込みます。
        読み込んだ内容が表で表示されるので、確認してから「取り込む」を押してください。表の書式は「書式のひな形」に合わせてください（列の順番は自由です）。
      </p>
      <MenuImport {...props} />
      <PriceImport {...props} mode="price" />
      <PriceImport {...props} mode="product" />
      <ConsentImport {...props} />
      {props.extra}
      <div className={styles.importBox}>
        <h3>Google との自動連携</h3>
        <p className={styles.hint}>
          表やフォルダを修正するたびに自動で反映するには、配布物の Apps Script を使います。設定手順は各ファイルの先頭を参照してください。
          <br />・料金表・自費商品：sheet-prices-standard.gs（「書式のひな形」と同じ形のスプレッドシートを、修正のたびに送信）
          <br />・同意書：consent-templates.gs（Google ドライブの文書を、開くたびに最新版で読み込み。読み込み元は「設定 → 同意書」で設定）
          <br />・問診票：questionnaire.gs（Google フォームの回答を、届くたびに送信）
        </p>
      </div>
    </section>
  );
}

/** ファイルを選ぶか、Google の共有リンクを入れて読む欄 */
function Source({ accept, kind, onTable, onDoc, busy }: { accept: string; kind: "sheet" | "doc"; onTable?: (t: Table, label: string) => void; onDoc?: (docs: { title: string; html: string }[]) => void; busy?: boolean }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className={styles.importSource}>
      <label className={styles.btn}>
        ファイルを選ぶ
        <input
          type="file"
          accept={accept}
          multiple={kind === "doc"}
          hidden
          disabled={busy || loading}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length === 0) return;
            run(async () => {
              if (kind === "sheet") onTable?.(await readTable(files[0]), files[0].name);
              else {
                const docs = await Promise.all(
                  files.map(async (f) => {
                    const bytes = new Uint8Array(await f.arrayBuffer());
                    if (/\.doc$/i.test(f.name)) throw new Error("古い Word 形式（.doc）は読み込めません。.docx で保存し直してください");
                    const html = /\.docx$/i.test(f.name) ? docxToHtml(bytes) : decodeText(bytes);
                    return { title: f.name.replace(/\.(docx|html?|txt)$/i, ""), html };
                  }),
                );
                onDoc?.(docs);
              }
            });
          }}
        />
      </label>
      <span className={styles.muted}>または</span>
      <input
        className={styles.input}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={kind === "sheet" ? "Google スプレッドシートの共有リンク" : "Google ドキュメントの共有リンク"}
        aria-label={kind === "sheet" ? "Google スプレッドシートの共有リンク" : "Google ドキュメントの共有リンク"}
      />
      <button
        type="button"
        className={styles.btn}
        disabled={!url.trim() || busy || loading}
        onClick={() =>
          run(async () => {
            const r = await importFetch(url.trim());
            if (r.kind !== kind) throw new Error(kind === "sheet" ? "スプレッドシートのリンクを入力してください" : "ドキュメントのリンクを入力してください");
            if (kind === "sheet") onTable?.(parseCsv(r.text), "Googleスプレッドシート");
            else onDoc?.([{ title: /<title>([^<]*)<\/title>/i.exec(r.text)?.[1]?.trim() || "Googleドキュメント", html: r.text }]);
          })
        }
      >
        {loading ? "読み込み中…" : "リンクから読み込む"}
      </button>
      {error && <span className={styles.importError}>{error}</span>}
    </div>
  );
}

function MenuImport({ menus, lanes, onChanged, notify, fail }: Props) {
  const [rows, setRows] = useState<MenuImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const existing = (name: string) => menus.find((m) => !m.deleted && searchKey(m.name) === searchKey(name));
  const ok = rows?.filter((r) => r.input) ?? [];

  return (
    <div className={styles.importBox}>
      <h3>
        メニュー
        <button type="button" className={styles.linkBtn} onClick={() => download("メニューの書式.csv", MENU_TEMPLATE)}>
          書式のひな形（CSV）
        </button>
      </h3>
      <p className={styles.hint}>同じ名前のメニューは内容を上書きし、新しい名前のメニューは追加します。ほかのメニューは変わりません。レーンはレーン名を「・」区切りで、すべてのレーンなら「すべて」と入力してください。</p>
      <Source
        accept=".csv,.tsv,.txt,.xlsx"
        kind="sheet"
        busy={busy}
        onTable={(t) => {
          const r = menuRowsFromTable(t, lanes);
          if ("error" in r) {
            setRows(null);
            setError(r.error);
          } else {
            setRows(r);
            setError(null);
          }
        }}
      />
      {error && <p className={styles.importError}>{error}</p>}
      {rows && (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>行</th>
                <th>メニュー名</th>
                <th>時間</th>
                <th>料金</th>
                <th>取り込み</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} data-inactive={!r.input || undefined}>
                  <td>{r.line}</td>
                  <td>{r.name}</td>
                  <td>
                    {r.input &&
                      (r.input.duration.kind === "fixed" ? `${r.input.duration.minutes}分` : `${r.input.duration.min}〜${r.input.duration.max}分`)}
                  </td>
                  <td>{r.input && (r.input.priceYen === null ? "—" : `¥${r.input.priceYen.toLocaleString("ja-JP")}`)}</td>
                  <td>{r.error ? <span className={styles.importError}>✕ {r.error}</span> : existing(r.name) ? "上書き" : "追加"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || ok.length === 0}
            onClick={async () => {
              setBusy(true);
              let done = 0;
              try {
                for (const r of ok) {
                  await saveMenu(existing(r.name)?.id ?? null, r.input!);
                  done++;
                }
                notify(`メニューを${done}件取り込みました`);
                setRows(null);
              } catch (e) {
                fail(e);
                if (done) notify(`${done}件まで取り込みました。残りは修正してから、もう一度取り込んでください`);
              } finally {
                setBusy(false);
                await onChanged();
              }
            }}
          >
            {busy ? "取り込み中…" : `${ok.length}件を取り込む`}
          </button>
        </>
      )}
    </div>
  );
}

const PRICE_MODE = {
  price: {
    title: "料金表（見積・会計の候補）",
    template: ["料金表の書式.csv", PRICE_TEMPLATE] as const,
    hint: "施術と商品をまとめた料金表です。「種類」の列に「施術」か「商品」を入力します。空欄の場合は、分類に「商品」「スキンケア」「内服」「外用」などを含む行を商品として扱います。商品はスキンケア・内服の候補に表示され、割引の「商品のみ」の対象になります。",
    defaultKind: undefined,
    defaultLabel: "",
  },
  product: {
    title: "自費商品（スキンケア・内服・外用）",
    template: ["自費商品の書式.csv", PRODUCT_TEMPLATE] as const,
    hint: "販売する商品の一覧です。すべて商品として、患者画面と見積・会計の「スキンケア・内服」に表示されます。分類（ゼオスキンヘルス・内服・外用など）は一覧の見出しになります。1件ずつ追加する場合は「設定 → スキンケア・内服」を使ってください。",
    defaultKind: "product" as const,
    defaultLabel: "自費商品",
  },
};

function PriceImport({ notify, fail, mode }: Props & { mode: keyof typeof PRICE_MODE }) {
  const m = PRICE_MODE[mode];
  const [rows, setRows] = useState<PriceImportRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = rows?.filter((r) => r.item) ?? [];
  return (
    <div className={styles.importBox}>
      <h3>
        {m.title}
        <button type="button" className={styles.linkBtn} onClick={() => download(m.template[0], m.template[1].map((r) => [...r]))}>
          書式のひな形（CSV）
        </button>
      </h3>
      <p className={styles.hint}>
        {m.hint}
        同じ「取り込みの名前」で取り込み直すと、前回取り込んだ内容がすべて置き換わります。
      </p>
      <Source
        accept=".csv,.tsv,.txt,.xlsx"
        kind="sheet"
        busy={busy}
        onTable={(t, name) => {
          const r = priceRowsFromTable(t, m.defaultKind);
          if ("error" in r) {
            setRows(null);
            setError(r.error);
          } else {
            setRows(r);
            setError(null);
            setLabel(m.defaultLabel || name.replace(/\.(csv|tsv|txt|xlsx)$/i, ""));
          }
        }}
      />
      {error && <p className={styles.importError}>{error}</p>}
      {rows && (
        <>
          <label className={styles.hint}>
            取り込みの名前（料金表での見出し）
            <input className={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} aria-label="取り込みの名前" style={{ maxWidth: 260, marginLeft: 6 }} />
          </label>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>行</th>
                <th>種類</th>
                <th>分類</th>
                <th>項目名</th>
                <th>料金</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} data-inactive={!r.item || undefined}>
                  <td>{r.line}</td>
                  <td>{r.item && (r.item.kind === "product" ? "商品" : "施術")}</td>
                  <td>{r.item?.category}</td>
                  <td>{r.name}</td>
                  <td>
                    {r.error ? (
                      <span className={styles.importError}>✕ {r.error}</span>
                    ) : r.item!.priceYen === null ? (
                      r.item!.priceText || "—"
                    ) : (
                      `¥${r.item!.priceYen.toLocaleString("ja-JP")}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || ok.length === 0 || !label.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await importPrices(`${IMPORT_SHEET_PREFIX}${label.trim()}`.slice(0, 60), ok.map((x) => x.item!));
                notify(`${m.title}を${r.count}件取り込みました（「設定 → 料金表」で確認できます）`);
                setRows(null);
              } catch (e) {
                fail(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "取り込み中…" : `${ok.length}件を取り込む`}
          </button>
        </>
      )}
    </div>
  );
}

function ConsentImport({ notify, fail }: Props) {
  const [docs, setDocs] = useState<{ title: string; html: string }[] | null>(null);
  const [uploaded, setUploaded] = useState<ConsentTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetchConsentTemplates({ cached: true }).then((r) => setUploaded(r.items.filter((t) => t.driveId.startsWith("upload-"))), () => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className={styles.importBox}>
      <h3>同意書のひな形</h3>
      <p className={styles.hint}>
        Word（.docx）・Google ドキュメント・HTML のファイルを、同意書のひな形として取り込みます（複数選択できます）。名前はファイル名になり、同じ名前のひな形は上書きします。
        「令和　年　月　日　氏名」の行に、日付と患者名が入ります。取り込み後、「設定 → 同意書」でメニューを設定できます。
      </p>
      <Source accept=".docx,.html,.htm" kind="doc" busy={busy} onDoc={(d) => setDocs(d)} />
      {docs && (
        <div className={styles.importSource}>
          {docs.map((d, i) => (
            <input
              key={i}
              className={styles.input}
              value={d.title}
              onChange={(e) => setDocs((ds) => ds!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              aria-label="同意書の名前"
              maxLength={120}
              style={{ maxWidth: 260 }}
            />
          ))}
          <button
            type="button"
            className={styles.primary}
            disabled={busy || docs.some((d) => !d.title.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await importConsentTemplates(docs);
                notify(`同意書を${r.count}件取り込みました`);
                invalidateConsentTemplates();
                setDocs(null);
                load();
              } catch (e) {
                fail(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "取り込み中…" : `${docs.length}件を取り込む`}
          </button>
        </div>
      )}
      {uploaded.length > 0 && (
        <table className={styles.table}>
          <tbody>
            {uploaded.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td className={styles.muted}>{new Date(t.modifiedTime).toLocaleDateString("ja-JP")} 取り込み</td>
                <td>
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={async () => {
                      if (!window.confirm(`「${t.title}」を削除します。よろしいですか？\n発行済みの控えは残ります。`)) return;
                      try {
                        await deleteConsentTemplate(t.id);
                        invalidateConsentTemplates();
                        notify("削除しました");
                        load();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
