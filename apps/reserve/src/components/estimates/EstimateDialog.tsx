"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Estimate, EstimateLine, Menu, PriceItem, Product } from "@/lib/domain/types";
import { DEFAULT_ESTIMATE_VALID_DAYS, PRODUCT_CATEGORY_LABEL, taxIncluded } from "@/lib/domain/types";
import { addDays, nowInClinic } from "@/lib/domain/time";
import { ApiError, createEstimate, estimatePrintUrl, fetchPrices, fetchSettings, updateEstimate } from "@/components/calendar/api";
import { searchKey } from "@/lib/domain/text";
import { usePref } from "@/components/calendar/usePref";
import { SCOPE_LABEL, discountName, discountYen, parseRate, priceCat, relatedPrices, type DiscountScope, type LineCat } from "@/lib/domain/estimateDiscount";
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
  /** 施術か商品か（割引をどれに掛けるかに使う） */
  cat: LineCat;
  /** 「チェックした項目のみ」の割引の対象か */
  picked: boolean;
}

/** 掛け率の割引（保存するときに金額の行にする） */
interface Discount {
  key: number;
  label: string;
  rate: string;
  scope: DiscountScope;
}

type DocKind = "estimate" | "bill";
const isDocKind = (v: unknown): v is DocKind => v === "estimate" || v === "bill";
const DOC_LABEL: Record<DocKind, string> = { estimate: "御見積書", bill: "御会計書" };

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

/** 見積書の行の名前：分類を前に付ける（「その他」などの大まかな分類は付けない） */
const PLAIN_CATEGORIES = new Set(["その他", "内服・外用など", "特殊メニュー", "施術料金一覧"]);
function lineName(p: PriceItem): string {
  if (PLAIN_CATEGORIES.has(p.category) || p.name.includes(p.category)) return p.name;
  return `${p.category} ${p.name}`;
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
      props.estimate?.lines.map((l) => ({
        key: nextKey(),
        kind: l.kind,
        refId: l.refId,
        name: l.name,
        unit: String(l.unitYen),
        qty: l.qty,
        cat: l.kind === "product" ? "product" : "treatment",
        picked: true,
      })) ?? [],
  );
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  // 予約メニュー（予約表の区別のための名前）は見積に出さず、料金表から選ぶ
  const [tab, setTab] = useState<"price" | "product">("price");
  /** 料金表（ホームページ・スプレッドシート・自由入力） */
  const [prices, setPrices] = useState<PriceItem[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Estimate | null>(null);
  /** 書類の種類（御見積書／御会計書）。端末ごとに前回の選択を覚えておく */
  const [kind, setKind] = usePref<DocKind>("estimateKind", "estimate", isDocKind);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    fetchPrices().then(
      (l) => {
        setPrices(l.items);
        // 直すときは、料金表と同じ名前の行を施術／商品に見分ける
        const catOf = new Map(l.items.map((p) => [lineName(p), priceCat(p)]));
        setRows((rs) => rs.map((r) => (r.kind === "custom" && catOf.has(r.name) ? { ...r, cat: catOf.get(r.name)! } : r)));
      },
      () => setPrices([]),
    );
  }, []);

  useEffect(() => {
    fetchSettings().then(
      (s) => {
        setMenus(s.menus);
        setProducts(s.products.filter((p) => p.active && !p.deleted));
        setValidDays(s.clinic.estimateValidDays ?? DEFAULT_ESTIMATE_VALID_DAYS);
      },
      () => setError("メニューを読み込めませんでした"),
    );
    // 開いたときに1回だけ
  }, []);

  const effectiveValidUntil = validUntil || addDays(date, validDays);
  const parsed = rows.map((r) => parseYen(r.unit));
  const rowsTotal = rows.reduce((sum, r, i) => sum + (parsed[i] ?? 0) * r.qty, 0);
  /** 掛け率の割引：対象の行（値段がプラスのもの）の合計に掛ける */
  const discountLines = discounts.map((d) => {
    const rate = parseRate(d.rate);
    const target = rows.reduce((sum, r, i) => {
      const v = parsed[i] ?? 0;
      if (v <= 0) return sum;
      const hit = d.scope === "all" || (d.scope === "checked" ? r.picked : r.cat === d.scope);
      return hit ? sum + v * r.qty : sum;
    }, 0);
    return { d, rate, target, amount: rate === null ? 0 : discountYen(target, rate) };
  });
  const total = rowsTotal + discountLines.reduce((sum, x) => sum + x.amount, 0);
  const showPick = discounts.some((d) => d.scope === "checked");
  const invalid =
    rows.length === 0 || parsed.some((v) => v === null) || rows.some((r) => !r.name.trim()) || discountLines.some((x) => x.rate === null) || total < 0;
  /** 予約から開いたとき：その予約のメニューに合う料金表の項目 */
  const related = useMemo(() => {
    if (!props.initialMenuIds?.length || !menus || !prices) return [];
    const names = props.initialMenuIds.map((id) => menus.find((m) => m.id === id)?.name ?? "");
    return relatedPrices(names, prices);
  }, [props.initialMenuIds, menus, prices]);

  const candidates = useMemo(() => {
    const key = searchKey(q);
    const list: { id: string; name: string; price: number | null; sub?: string; text?: string }[] =
      tab === "price"
        ? (prices ?? []).map((p) => ({ id: p.id, name: lineName(p), price: p.priceYen, sub: p.category, text: p.priceText }))
        : products.map((p) => ({ id: p.id, name: p.name, price: p.priceYen, sub: PRODUCT_CATEGORY_LABEL[p.category] }));
    return key ? list.filter((x) => searchKey(`${x.sub ?? ""} ${x.name}`).includes(key)) : list;
  }, [tab, q, products, prices]);

  /** 料金表の項目は「自由入力の行」として入れる（見積書には名前と値段を写して残す） */
  const add = (tab0: "price" | "product", id: string, name: string, price: number | null) => {
    const kind = tab0 === "price" ? "custom" : tab0;
    const p = tab0 === "price" ? prices?.find((x) => x.id === id) : undefined;
    const cat: LineCat = tab0 === "product" ? "product" : p ? priceCat(p) : "treatment";
    setRows((rs) => {
      const same = rs.find((r) => (kind === "custom" ? r.kind === "custom" && r.name === name : r.kind === kind && r.refId === id));
      if (same) return rs.map((r) => (r === same ? { ...r, qty: Math.min(99, r.qty + 1) } : r));
      return [...rs, { key: nextKey(), kind, ...(kind !== "custom" && { refId: id }), name, unit: price === null ? "" : String(price), qty: 1, cat, picked: true }];
    });
  };
  const patchDiscount = (key: number, p: Partial<Discount>) => setDiscounts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    const lines: EstimateLine[] = [
      ...rows.map((r, i) => ({
        kind: r.kind,
        ...(r.kind !== "custom" && { refId: r.refId }),
        name: r.name,
        unitYen: parsed[i]!,
        qty: r.qty,
      })),
      // 掛け率の割引は、計算した金額の行として残す
      ...discountLines
        .filter((x) => x.amount !== 0)
        .map((x) => ({ kind: "custom" as const, name: discountName(x.d.label, x.d.scope, x.rate!), unitYen: x.amount, qty: 1 })),
    ];
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
    <dialog ref={ref} className={styles.dialog} onCancel={props.onClose} aria-label="見積・会計">
      <div className={styles.head}>
        <h2>
          {props.estimate ? `${DOC_LABEL[kind]} No.${props.estimate.no} を直す` : `${DOC_LABEL[kind]}を作る`}
          <small>{props.patientName} 様</small>
        </h2>
        <div className={styles.kindSwitch} role="radiogroup" aria-label="書類の種類">
          {(["estimate", "bill"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} data-active={kind === k || undefined} onClick={() => setKind(k)}>
              {DOC_LABEL[k]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.iconBtn} onClick={props.onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      {saved ? (
        <div className={styles.done}>
          <p>
            {DOC_LABEL[kind]} <b>No.{saved.no}</b>（合計 {yen(saved.totalYen)}）を保存しました。
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={props.onClose}>
              閉じる
            </button>
            <a className={styles.primaryBtn} href={estimatePrintUrl(saved.id, kind)} target="_blank" rel="noopener">
              🖨 {DOC_LABEL[kind]}を印刷
            </a>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.picker}>
            <div className={styles.tabs} role="tablist">
              <button type="button" role="tab" aria-selected={tab === "price"} data-active={tab === "price" || undefined} onClick={() => setTab("price")}>
                料金表
              </button>
              <button type="button" role="tab" aria-selected={tab === "product"} data-active={tab === "product" || undefined} onClick={() => setTab("product")}>
                スキンケア＆内服
              </button>
              <input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="さがす" aria-label="項目をさがす" />
            </div>
            {related.length > 0 && tab === "price" && !q && (
              <div className={styles.related}>
                <span className={styles.relatedLabel}>この予約のメニューに合う料金</span>
                <div className={styles.chips}>
                  {related.map((p) => (
                    <button key={p.id} type="button" className={styles.chip} data-related onClick={() => add("price", p.id, lineName(p), p.priceYen)} title={p.priceText}>
                      <small>{p.category}</small>
                      <span>{p.name}</span>
                      <b>{p.priceYen === null ? p.priceText || "値段未設定" : yen(p.priceYen)}</b>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.chips}>
              {tab === "price" && prices === null && <span className={styles.muted}>読み込み中…</span>}
              {(tab !== "price" || prices !== null) && candidates.length === 0 && (
                <span className={styles.muted}>{tab === "price" && !q ? "料金表が空です（設定 → 料金表）" : "見つかりません"}</span>
              )}
              {candidates.map((c) => (
                <button key={c.id} type="button" className={styles.chip} onClick={() => add(tab, c.id, c.name, c.price)} title={c.text ? `${c.name}：${c.text}` : "押すと見積に追加"}>
                  {tab === "price" && c.sub && <small>{c.sub}</small>}
                  <span>{c.name}</span>
                  <b>{c.price === null ? c.text || "値段未設定" : yen(c.price)}</b>
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
                    上の料金表・スキンケア＆内服を押すと追加されます
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.key} data-discount={(parsed[i] ?? 0) < 0 || undefined}>
                  <td>
                    <span className={styles.nameCell}>
                      {showPick && (
                        <input
                          type="checkbox"
                          className={styles.pick}
                          checked={r.picked}
                          onChange={(e) => patch(r.key, { picked: e.target.checked })}
                          aria-label={`${r.name || "この行"}を割引の対象にする`}
                        />
                      )}
                      {(parsed[i] ?? 0) >= 0 && (
                        <button
                          type="button"
                          className={styles.catBtn}
                          data-cat={r.cat}
                          onClick={() => patch(r.key, { cat: r.cat === "treatment" ? "product" : "treatment" })}
                          title="押すと施術／商品を切り替え（割引の対象を決めるのに使います）"
                        >
                          {r.cat === "treatment" ? "施術" : "商品"}
                        </button>
                      )}
                      <input value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} aria-label="項目名" maxLength={120} />
                    </span>
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
              {discountLines.map(({ d, rate, target, amount }) => (
                <tr key={`d${d.key}`} data-discount className={styles.discountRow}>
                  <td colSpan={3}>
                    <div className={styles.discountEdit}>
                      <input value={d.label} onChange={(e) => patchDiscount(d.key, { label: e.target.value })} aria-label="割引の名前" maxLength={30} className={styles.discountLabel} />
                      <label className={styles.rateField}>
                        掛け率
                        <input
                          value={d.rate}
                          onChange={(e) => patchDiscount(d.key, { rate: e.target.value })}
                          aria-label="掛け率"
                          aria-invalid={rate === null}
                          placeholder="0.9"
                          inputMode="decimal"
                        />
                      </label>
                      {["0.95", "0.9", "0.8", "0.7"].map((v) => (
                        <button key={v} type="button" className={styles.rateChip} data-on={d.rate === v || undefined} onClick={() => patchDiscount(d.key, { rate: v })}>
                          ×{v}
                        </button>
                      ))}
                      <select value={d.scope} onChange={(e) => patchDiscount(d.key, { scope: e.target.value as DiscountScope })} aria-label="割引の対象">
                        {(Object.keys(SCOPE_LABEL) as DiscountScope[]).map((k) => (
                          <option key={k} value={k}>
                            {SCOPE_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      <small className={styles.muted}>
                        対象 {yen(target)}
                        {rate === null && "（掛け率は 0.9 や 10%引き のように）"}
                      </small>
                    </div>
                  </td>
                  <td className={styles.num}>{yen(amount)}</td>
                  <td>
                    <button type="button" className={styles.remove} onClick={() => setDiscounts((ds) => ds.filter((x) => x.key !== d.key))} aria-label="この割引を消す">
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
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setRows((rs) => [...rs, { key: nextKey(), kind: "custom", name: "", unit: "", qty: 1, cat: "treatment", picked: true }])}
                    >
                      ＋自由入力の行
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setDiscounts((ds) => [...ds, { key: nextKey(), label: "割引", rate: "0.9", scope: "treatment" }])}
                    >
                      ＋割引（掛け率）
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setRows((rs) => [...rs, { key: nextKey(), kind: "custom", name: "割引", unit: "-", qty: 1, cat: "treatment", picked: false }])}
                    >
                      ＋割引（金額）
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
              {saving ? "保存中…" : props.estimate ? "保存する" : `${DOC_LABEL[kind]}を作る`}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
