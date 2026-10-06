"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PriceItem, PriceList } from "@/lib/domain/types";
import { deletePriceItem, fetchPrices, savePriceItem, savePriceSheetSource, savePriceUrls, syncPricesNow } from "@/components/calendar/api";
import { searchKey } from "@/lib/domain/text";
import styles from "./settings.module.css";

const SOURCE_LABEL: Record<PriceItem["source"], string> = { homepage: "ホームページ", sheet: "スプレッドシート", manual: "自由入力" };

const parseYen = (s: string): number | null | undefined => {
  const t = s.normalize("NFKC").replace(/[,，円\s]/g, "").replace(/^[−ー]/, "-");
  if (t === "") return null;
  return /^-?\d{1,8}$/.test(t) ? Number(t) : undefined;
};

const stamp = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "まだ";

/** 料金表：ホームページ（正本）・スプレッドシートから取り込んだ料金と、自由入力の料金 */
export function PricesTab({ canEdit, isAdmin, notify, fail }: { canEdit: boolean; isAdmin: boolean; notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [list, setList] = useState<PriceList | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [urls, setUrls] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetKey, setSheetKey] = useState("");
  const [cat, setCat] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const priceVal = parseYen(price);

  const load = useCallback(async () => {
    try {
      const l = await fetchPrices();
      setList(l);
      setUrls(l.urls.join("\n"));
      setSheetUrl(l.sheetSource?.url ?? "");
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    // 開いたときに読み込む（1日以上たっていればサーバー側でホームページから取り込み直す）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "items" in r) {
        setList(r as PriceList);
        setUrls((r as PriceList).urls.join("\n"));
      } else await load();
      notify(message);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const key = searchKey(q);
    const out = new Map<string, PriceItem[]>();
    for (const p of list?.items ?? []) {
      if (key && !searchKey(`${p.category} ${p.name}`).includes(key)) continue;
      const g = `${SOURCE_LABEL[p.source]}｜${p.category}`;
      out.set(g, [...(out.get(g) ?? []), p]);
    }
    return [...out.entries()];
  }, [list, q]);

  if (!list) return <p className={styles.muted}>読み込み中…</p>;
  const failed = list.results.filter((r) => !r.ok);

  return (
    <section>
      <p className={styles.lead}>
        見積書で選べる料金の一覧です。<b>ホームページの料金表が正本</b>で、1日1回自動で取り込み直します（ホームページを直せばここも変わります）。
        脱毛ページのように「税抜」と書かれた表は、税込（×1.1）に直して取り込みます。
        ゼオなどはスプレッドシートから自動で送られてきます。どちらにもない料金は、下の「自由入力」で足せます。
      </p>

      <div className={styles.priceStatus}>
        <span>
          ホームページ：最終取り込み {stamp(list.syncedAt)}
          {list.results.map((r) => (
            <span key={r.url} className={styles.priceSource} data-ok={r.ok || undefined}>
              {r.ok ? `✓ ${r.count}件` : `✕ ${r.error}`}：{r.url.replace(/^https?:\/\//, "")}
            </span>
          ))}
        </span>
        {list.sheets.map((s) => (
          <span key={s.name}>
            スプレッドシート「{s.name}」：{stamp(s.at)} に {s.count}件 受け取り
          </span>
        ))}
        {list.sheetPull && !list.sheetPull.ok && (
          <span className={styles.priceSource}>✕ スプレッドシート：{list.sheetPull.error}（{stamp(list.sheetPull.at)}）</span>
        )}
        {canEdit && (
          <button
            className={styles.primary}
            disabled={busy || (list.urls.length === 0 && !list.sheetSource?.url)}
            onClick={() => run(syncPricesNow, list.sheetSource?.url ? "ホームページとスプレッドシートから取り込みました" : "ホームページから取り込みました")}
          >
            {busy ? "取り込み中…" : "今すぐ取り込む"}
          </button>
        )}
      </div>
      {failed.length > 0 && <p className={styles.hint} data-invalid>読めなかったページの料金は、前回取り込んだ内容のまま使います。</p>}

      {isAdmin && (
        <details className={styles.priceUrls}>
          <summary>スプレッドシートの読み込み元（「今すぐ取り込む」でスプレッドシートも読みに行く）</summary>
          <p className={styles.hint}>
            料金表のスプレッドシートの Apps Script を「ウェブアプリ」としてデプロイし、出てきた URL（https://script.google.com/macros/s/…/exec）と、スクリプト プロパティの KEY に入れた合言葉を入れます。
            入れなくても、シートを直したときや毎朝6時にはスプレッドシート側から送られてきます。
          </p>
          <input className={styles.input} value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" aria-label="スプレッドシートの読み込み元" />
          <input
            className={styles.input}
            type="password"
            value={sheetKey}
            onChange={(e) => setSheetKey(e.target.value)}
            placeholder={list.sheetSource?.hasKey ? "合言葉（変えるときだけ入力）" : "合言葉（KEY）"}
            aria-label="合言葉"
            autoComplete="off"
          />
          <button
            className={styles.primary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await savePriceSheetSource(sheetUrl.trim(), sheetKey.trim() || undefined);
                setSheetKey("");
                return syncPricesNow();
              }, "読み込み元を保存して取り込みました")
            }
          >
            保存して取り込む
          </button>
        </details>
      )}

      {isAdmin && (
        <details className={styles.priceUrls}>
          <summary>取り込むホームページ（院長・管理者のみ変更できます）</summary>
          <textarea className={styles.input} rows={3} value={urls} onChange={(e) => setUrls(e.target.value)} aria-label="取り込むホームページのアドレス（1行に1つ）" />
          <button
            className={styles.primary}
            disabled={busy}
            onClick={() => run(() => savePriceUrls(urls.split(/\s+/).filter(Boolean)), "取り込み元を保存して取り込みました")}
          >
            保存して取り込む
          </button>
        </details>
      )}

      <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="料金をさがす" aria-label="料金をさがす" style={{ maxWidth: 320, margin: "8px 0" }} />

      {groups.map(([g, items]) => (
        <div key={g} className={styles.priceGroup}>
          <h3>{g}</h3>
          <table className={styles.table}>
            <tbody>
              {items.map((p) =>
                p.source === "manual" ? (
                  <ManualRow key={`${p.id}:${p.updatedAt}`} item={p} canEdit={canEdit} onSave={(b) => run(() => savePriceItem(p.id, b), "保存しました")} onDelete={() => {
                    if (window.confirm(`「${p.name}」を削除しますか？`)) run(() => deletePriceItem(p.id), "削除しました");
                  }} />
                ) : (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className={styles.priceCol}>{p.priceYen === null ? "—" : `¥${p.priceYen.toLocaleString("ja-JP")}`}</td>
                    {/* 値段が決まっているものは税込価格だけ。「要相談」や「1本なら6,600円」のような補足があるときだけ表示の文字を出す */}
                    <td className={styles.muted}>{extraText(p)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ))}

      {canEdit && (
        <div className={styles.priceGroup}>
          <h3>自由入力の料金を足す</h3>
          <div className={styles.priceAdd}>
            <input className={styles.input} value={cat} onChange={(e) => setCat(e.target.value)} placeholder="分類（例：診察）" aria-label="分類" maxLength={60} />
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="項目名（例：初診料）" aria-label="項目名" maxLength={120} />
            <input className={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="税込の値段" inputMode="numeric" aria-label="値段" aria-invalid={priceVal === undefined || undefined} />
            <button
              className={styles.primary}
              disabled={busy || !name.trim() || priceVal === undefined}
              onClick={() =>
                run(async () => {
                  await savePriceItem(null, { category: cat, name, priceYen: priceVal ?? null });
                  setName("");
                  setPrice("");
                }, "追加しました")
              }
            >
              追加
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ManualRow({ item, canEdit, onSave, onDelete }: { item: PriceItem; canEdit: boolean; onSave: (b: { category: string; name: string; priceYen: number | null }) => void; onDelete: () => void }) {
  const [cat, setCat] = useState(item.category);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.priceYen === null ? "" : String(item.priceYen));
  const priceVal = parseYen(price);
  const dirty = cat !== item.category || name !== item.name || priceVal !== item.priceYen;
  if (!canEdit) {
    return (
      <tr>
        <td>{item.name}</td>
        <td className={styles.priceCol}>{item.priceYen === null ? "—" : `¥${item.priceYen.toLocaleString("ja-JP")}`}</td>
        <td />
      </tr>
    );
  }
  return (
    <tr>
      <td>
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} aria-label="項目名" maxLength={120} />
      </td>
      <td className={styles.priceCol}>
        <input className={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" aria-label="値段" aria-invalid={priceVal === undefined || undefined} />
      </td>
      <td>
        <input className={styles.input} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="分類" maxLength={60} style={{ maxWidth: "10em" }} />
        <button className={styles.primary} disabled={!dirty || !name.trim() || priceVal === undefined} onClick={() => onSave({ category: cat, name, priceYen: priceVal ?? null })}>
          保存
        </button>
        <button className={styles.btn} onClick={onDelete}>
          削除
        </button>
      </td>
    </tr>
  );
}

/** 表示の文字のうち、税込価格の繰り返しでない補足（なければ空） */
function extraText(p: PriceItem): string {
  const t = p.priceText.trim();
  if (p.priceYen === null) return t;
  const plain = t.replace(/[,，\s円¥￥]|税込|（税込）|\(税込\)/g, "");
  return plain === String(p.priceYen) ? "" : t;
}
