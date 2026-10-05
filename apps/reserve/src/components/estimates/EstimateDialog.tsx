"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Estimate, EstimateLine, Menu, Product } from "@/lib/domain/types";
import { DEFAULT_ESTIMATE_VALID_DAYS, PRODUCT_CATEGORY_LABEL, taxIncluded } from "@/lib/domain/types";
import { addDays, nowInClinic } from "@/lib/domain/time";
import { ApiError, createEstimate, estimatePrintUrl, fetchSettings, updateEstimate } from "@/components/calendar/api";
import { searchKey } from "@/lib/domain/text";
import styles from "./estimates.module.css";

interface Props {
  patientId: string;
  patientName: string;
  /** 予約から作るとき：その予約のメニューを最初に入れる */
  reservationId?: string;
  initialMenuIds?: string[];
  /** 作った見積書を直すとき */
  estimate?: Estimate;
  onClose(): void;
  onSaved(e: Estimate): void;
}

/** 入力中の行（値段・数量は文字のまま持つ） */
interface Row {
  key: number;
  kind: EstimateLine["kind"];
  refId?: string;
  name: string;
  unit: string;
  qty: number;
}

export const yen = (n: number) => `${n < 0 ? "−" : ""}¥${Math.abs(n).toLocaleString("ja-JP")}`;

/** "12,000" "１２０００円" "-3000" などを数に。読めなければ null */
function parseYen(s: string): number | null {
  const t = s
    .normalize("NFKC")
    .replace(/[,，円¥\s]/g, "")
    .replace(/^[−ー–]/, "-");
  if (!/^-?\d{1,9}$/.test(t)) return null;
  return Number(t);
}

let seq = 0;
const nextKey = () => ++seq;

export function EstimateDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [menus, setMenus] = useState<Menu[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [validDays, setValidDays] = useState(DEFAULT_ESTIMATE_VALID_DAYS);
  const today = nowInClinic().date;
  const [date, setDate] = useState(props.estimate?.date ?? today);
  const [validUntil, setValidUntil] = useState(props.estimate?.validUntil ?? "");
  const [note, setNote] = useState(props.estimate?.note ?? "");
  const [rows, setRows] = useState<Row[]>(
    () =>
      props.estimate?.lines.map((l) => ({ key: nextKey(), kind: l.kind, refId: l.refId, name: l.name, unit: String(l.unitYen), qty: l.qty })) ?? [],
  );
  const [tab, setTab] = useState<"menu" | "product">("menu");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Estimate | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    fetchSettings().then(
      (s) => {
        setMenus(s.menus);
        setProducts(s.products.filter((p) => p.active && !p.deleted));
        setValidDays(s.clinic.estimateValidDays ?? DEFAULT_ESTIMATE_VALID_DAYS);
        // 予約から作るときは、その予約のメニューを最初に入れておく
        if (!props.estimate && props.initialMenuIds?.length) {
          setRows(
            props.initialMenuIds
              .map((id) => s.menus.find((m) => m.id === id))
              .filter((m): m is Menu => !!m)
              .map((m) => ({ key: nextKey(), kind: "menu", refId: m.id, name: m.name, unit: m.priceYen === null ? "" : String(m.priceYen), qty: 1 })),
          );
        }
      },
      () => setError("メニューを読み込めませんでした"),
    );
    // 開いたときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveValidUntil = validUntil || addDays(date, validDays);
  const parsed = rows.map((r) => parseYen(r.unit));
  const total = rows.reduce((sum, r, i) => sum + (parsed[i] ?? 0) * r.qty, 0);
  const invalid = rows.length === 0 || parsed.some((v) => v === null) || rows.some((r) => !r.name.trim()) || total < 0;

  const candidates = useMemo(() => {
    const key = searchKey(q);
    const list: { id: string; name: string; price: number | null; sub?: string }[] =
      tab === "menu"
        ? (menus ?? []).filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, price: m.priceYen }))
        : products.map((p) => ({ id: p.id, name: p.name, price: p.priceYen, sub: PRODUCT_CATEGORY_LABEL[p.category] }));
    return key ? list.filter((x) => searchKey(x.name).includes(key)) : list;
  }, [tab, q, menus, products]);

  const add = (kind: "menu" | "product", id: string, name: string, price: number | null) => {
    setRows((rs) => {
      const same = rs.find((r) => r.kind === kind && r.refId === id);
      if (same) return rs.map((r) => (r === same ? { ...r, qty: Math.min(99, r.qty + 1) } : r));
      return [...rs, { key: nextKey(), kind, refId: id, name, unit: price === null ? "" : String(price), qty: 1 }];
    });
  };

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    const lines: EstimateLine[] = rows.map((r, i) => ({
      kind: r.kind,
      ...(r.kind !== "custom" && { refId: r.refId }),
      name: r.name,
      unitYen: parsed[i]!,
      qty: r.qty,
    }));
    try {
      const e = props.estimate
        ? await updateEstimate(props.estimate.id, { version: props.estimate.version, date, validUntil: effectiveValidUntil, lines, note })
        : await createEstimate(props.patientId, {
            ...(props.reservationId && { reservationId: props.reservationId }),
            date,
            validUntil: effectiveValidUntil,
            lines,
            note,
          });
      setSaved(e);
      props.onSaved(e);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={props.onClose} aria-label="見積書">
      <div className={styles.head}>
        <h2>
          {props.estimate ? `見積書 No.${props.estimate.no} を直す` : "見積書を作る"}
          <small>{props.patientName} 様</small>
        </h2>
        <button type="button" className={styles.iconBtn} onClick={props.onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      {saved ? (
        <div className={styles.done}>
          <p>
            見積書 <b>No.{saved.no}</b>（合計 {yen(saved.totalYen)}）を保存しました。
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={props.onClose}>
              閉じる
            </button>
            <a className={styles.primaryBtn} href={estimatePrintUrl(saved.id)} target="_blank" rel="noopener">
              🖨 印刷する
            </a>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.picker}>
            <div className={styles.tabs} role="tablist">
              <button type="button" role="tab" aria-selected={tab === "menu"} data-active={tab === "menu" || undefined} onClick={() => setTab("menu")}>
                メニュー
              </button>
              <button type="button" role="tab" aria-selected={tab === "product"} data-active={tab === "product" || undefined} onClick={() => setTab("product")}>
                スキンケア＆内服
              </button>
              <input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="さがす" aria-label="項目をさがす" />
            </div>
            <div className={styles.chips}>
              {menus === null && <span className={styles.muted}>読み込み中…</span>}
              {menus !== null && candidates.length === 0 && <span className={styles.muted}>見つかりません</span>}
              {candidates.map((c) => (
                <button key={c.id} type="button" className={styles.chip} onClick={() => add(tab, c.id, c.name, c.price)} title="押すと見積に追加">
                  <span>{c.name}</span>
                  <b>{c.price === null ? "値段未設定" : yen(c.price)}</b>
                </button>
              ))}
            </div>
          </div>

          <table className={styles.lines}>
            <thead>
              <tr>
                <th>項目</th>
                <th className={styles.num}>単価（税込）</th>
                <th className={styles.qtyCol}>数量</th>
                <th className={styles.num}>金額</th>
                <th aria-label="削除" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    上のメニュー・スキンケア＆内服を押すと追加されます
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.key} data-discount={(parsed[i] ?? 0) < 0 || undefined}>
                  <td>
                    <input value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} aria-label="項目名" maxLength={120} />
                  </td>
                  <td className={styles.num}>
                    <input
                      value={r.unit}
                      inputMode="numeric"
                      onChange={(e) => patch(r.key, { unit: e.target.value })}
                      aria-label="単価"
                      aria-invalid={parsed[i] === null}
                      placeholder="値段"
                    />
                  </td>
                  <td className={styles.qtyCol}>
                    <span className={styles.stepper}>
                      <button type="button" onClick={() => patch(r.key, { qty: Math.max(1, r.qty - 1) })} aria-label="減らす">
                        −
                      </button>
                      <b>{r.qty}</b>
                      <button type="button" onClick={() => patch(r.key, { qty: Math.min(99, r.qty + 1) })} aria-label="増やす">
                        ＋
                      </button>
                    </span>
                  </td>
                  <td className={styles.num}>{parsed[i] === null ? "—" : yen(parsed[i]! * r.qty)}</td>
                  <td>
                    <button type="button" className={styles.remove} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="この行を消す">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>
                  <div className={styles.addRow}>
                    <button type="button" className={styles.btn} onClick={() => setRows((rs) => [...rs, { key: nextKey(), kind: "custom", name: "", unit: "", qty: 1 }])}>
                      ＋自由入力の行
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setRows((rs) => [...rs, { key: nextKey(), kind: "custom", name: "割引", unit: "-", qty: 1 }])}
                    >
                      ＋割引
                    </button>
                    <span className={styles.total}>
                      合計（税込）<b>{yen(total)}</b>
                      <small>うち消費税 {yen(taxIncluded(Math.max(0, total)))}</small>
                    </span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>

          <div className={styles.meta}>
            <label>
              発行日
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <label>
              有効期限
              <input type="date" value={effectiveValidUntil} min={date} onChange={(e) => setValidUntil(e.target.value)} />
            </label>
            <label className={styles.noteField}>
              備考（見積書に載ります）
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="例：3回コースでのご提案です" />
            </label>
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {total < 0 && <p className={styles.error}>合計がマイナスです。割引の金額を確かめてください</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={props.onClose}>
              やめる
            </button>
            <button type="button" className={styles.primaryBtn} onClick={save} disabled={invalid || saving}>
              {saving ? "保存中…" : props.estimate ? "保存する" : "見積書を作る"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
