"use client";

import { useCallback, useEffect, useState } from "react";
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
import { MENU_TEMPLATE, PRICE_TEMPLATE, menuRowsFromTable, priceRowsFromTable, type MenuImportRow, type PriceImportRow } from "@/lib/domain/importMap";
import { IMPORT_SHEET_PREFIX } from "@/lib/domain/estimateDiscount";
import { searchKey } from "@/lib/domain/text";
import styles from "./settings.module.css";

interface Props {
  menus: Menu[];
  lanes: Lane[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (t: string) => void;
  fail: (e: unknown) => void;
}

/** ファイル（CSV・Excel）を表にする */
async function readTable(file: File): Promise<Table> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(bytes);
  if (/\.xls$/i.test(file.name)) throw new Error("古い Excel（.xls）は読めません。.xlsx か CSV で保存し直してください");
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

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "読み込めませんでした");

/**
 * 取り込み：メニュー・料金表・同意書を、決まった書式のファイル（CSV・Excel・Word）や
 * Googleスプレッドシート／ドキュメントの共有リンクから入れる。読む前に中身を見せて、確かめてから取り込む
 */
export function ImportsTab(props: Props) {
  if (!props.canEdit) return <p className={styles.lead}>取り込みは、管理操作のできるスタッフだけが使えます。</p>;
  return (
    <section>
      <p className={styles.lead}>
        ほかのソフトや表で作ったメニュー・料金表・同意書を、まとめて取り込めます。
        <b>CSV・Excel（.xlsx）・Word（.docx）</b>のファイルか、<b>Googleスプレッドシート／ドキュメントの共有リンク</b>（共有の設定を「リンクを知っている全員」）から読みます。
        読み込んだら中身が表で出るので、確かめてから「取り込む」を押してください。表の書式は「書式のひな形」を開いて、その形に合わせてください（列の順番は自由です）。
      </p>
      <MenuImport {...props} />
      <PriceImport {...props} />
      <ConsentImport {...props} />
      <div className={styles.importBox}>
        <h3>Googleと自動でつなぐ</h3>
        <p className={styles.hint}>
          表やフォルダを直すたびに自動で反映したいときは、配布物に入っている Apps Script を使います（置き方は各ファイルの先頭に書いてあります）。
          <br />・料金表：sheet-prices.gs（スプレッドシートを直すと送られる）
          <br />・同意書：consent-templates.gs（Googleドライブのフォルダの文書を、開くたびに最新で読む。設定 → 同意書 で読み込み元を入れる）
          <br />・問診票：questionnaire.gs（Googleフォームの回答が届くたびに送られる）
        </p>
      </div>
    </section>
  );
}

/** ファイルを選ぶか、Googleの共有リンクを入れて読む欄 */
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
                    if (/\.doc$/i.test(f.name)) throw new Error("古い Word（.doc）は読めません。.docx で保存し直してください");
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
        placeholder={kind === "sheet" ? "Googleスプレッドシートの共有リンク" : "Googleドキュメントの共有リンク"}
        aria-label={kind === "sheet" ? "Googleスプレッドシートの共有リンク" : "Googleドキュメントの共有リンク"}
      />
      <button
        type="button"
        className={styles.btn}
        disabled={!url.trim() || busy || loading}
        onClick={() =>
          run(async () => {
            const r = await importFetch(url.trim());
            if (r.kind !== kind) throw new Error(kind === "sheet" ? "スプレッドシートのリンクを入れてください" : "ドキュメントのリンクを入れてください");
            if (kind === "sheet") onTable?.(parseCsv(r.text), "Googleスプレッドシート");
            else onDoc?.([{ title: /<title>([^<]*)<\/title>/i.exec(r.text)?.[1]?.trim() || "Googleドキュメント", html: r.text }]);
          })
        }
      >
        {loading ? "読み込み中…" : "リンクから読む"}
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
      <p className={styles.hint}>同じ名前のメニューは中身を入れ替え、ない名前は新しく足します（今あるほかのメニューはそのまま）。レーンは設定のレーンの名前で「・」区切り、全部なら「すべて」。</p>
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
                  <td>{r.error ? <span className={styles.importError}>✕ {r.error}</span> : existing(r.name) ? "入れ替え" : "新しく足す"}</td>
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
                if (done) notify(`${done}件まで取り込みました。残りは直してからもう一度`);
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

function PriceImport({ notify, fail }: Props) {
  const [rows, setRows] = useState<PriceImportRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = rows?.filter((r) => r.item) ?? [];
  return (
    <div className={styles.importBox}>
      <h3>
        料金表（見積・会計の候補、スキンケア＆内服の候補）
        <button type="button" className={styles.linkBtn} onClick={() => download("料金表の書式.csv", PRICE_TEMPLATE)}>
          書式のひな形（CSV）
        </button>
      </h3>
      <p className={styles.hint}>
        同じ名前で取り込み直すと、前に取り込んだ分とまるごと入れ替わります。分類に「商品」「スキンケア」「内服」「外用」などを入れた行は商品として扱います（スキンケア＆内服の候補に出て、割引の「商品のみ」の対象になります）。
      </p>
      <Source
        accept=".csv,.tsv,.txt,.xlsx"
        kind="sheet"
        busy={busy}
        onTable={(t, name) => {
          const r = priceRowsFromTable(t);
          if ("error" in r) {
            setRows(null);
            setError(r.error);
          } else {
            setRows(r);
            setError(null);
            setLabel(name.replace(/\.(csv|tsv|txt|xlsx)$/i, ""));
          }
        }}
      />
      {error && <p className={styles.importError}>{error}</p>}
      {rows && (
        <>
          <label className={styles.hint}>
            取り込みの名前（料金表の画面での見出し）
            <input className={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} aria-label="取り込みの名前" style={{ maxWidth: 260, marginLeft: 6 }} />
          </label>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>行</th>
                <th>分類</th>
                <th>項目名</th>
                <th>料金</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} data-inactive={!r.item || undefined}>
                  <td>{r.line}</td>
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
                notify(`料金表を${r.count}件取り込みました（設定 → 料金表 で見られます）`);
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
    fetchConsentTemplates().then((r) => setUploaded(r.items.filter((t) => t.driveId.startsWith("upload-"))), () => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className={styles.importBox}>
      <h3>同意書のひな形</h3>
      <p className={styles.hint}>
        Word（.docx）・Googleドキュメント・HTML のファイルを、同意書のひな形として取り込みます（いくつでも同時に選べます）。名前はファイル名で、同じ名前は入れ替えます。
        「令和　年　月　日　氏名」の行に、日付と患者の名前が入ります。取り込んだあと 設定 → 同意書 でメニューと結びつけられます。
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
                      if (!window.confirm(`「${t.title}」を削除しますか？（発行済みの控えはそのまま残ります）`)) return;
                      try {
                        await deleteConsentTemplate(t.id);
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
