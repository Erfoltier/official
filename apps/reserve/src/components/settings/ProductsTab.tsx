"use client";

import { useState } from "react";
import type { Product, ProductCategory } from "@/lib/domain/types";
import { PRODUCT_CATEGORY_LABEL } from "@/lib/domain/types";
import { deleteProduct, reorder, saveProduct } from "@/components/calendar/api";
import styles from "./settings.module.css";

const yen = (n: number | null) => (n === null ? "" : String(n));
const parseYen = (s: string): number | null | undefined => {
  const t = s.normalize("NFKC").replace(/[,，円\s]/g, "");
  if (t === "") return null;
  return /^\d{1,8}$/.test(t) ? Number(t) : undefined;
};

/** スキンケア・内服のプリセット（施術歴でタップして追加する一覧） */
export function ProductsTab({
  products,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  products: Product[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProductCategory>("skincare");
  const [price, setPrice] = useState("");
  const priceVal = parseYen(price);

  const run = async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      await onChanged();
      if (message) notify(message);
    } catch (err) {
      fail(err);
      await onChanged();
    }
  };

  const move = (i: number, d: number) => {
    const ids = products.map((p) => p.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorder("products", ids));
  };

  return (
    <section>
      <p className={styles.lead}>
        スキンケア＆内服の候補は「料金表」の商品（スプレッドシート・ホームページ・取り込みから入ったもの）から自動で入ります。
        ここでは、料金表にない商品を1つずつ手で足せます（施術歴や見積・会計で「院で追加した商品」として出ます）。価格（税込）も入れておけます。
        たくさんの商品をまとめて入れるときは「設定 → 取り込み」の「自費商品」から、表（CSV・Excel・Googleスプレッドシート）で入れられます。
        しばらく使わないものは「候補に出す」を外すと隠れ（あとで戻せます）、不要になったものは「削除」できます。
        どちらも、施術歴に記録した内容はそのまま残ります。
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.orderCol}>順番</th>
            <th>名前</th>
            <th>種類</th>
            <th>価格（円）</th>
            <th>候補に出す</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <ProductRow
              key={`${p.id}:${p.name}:${p.category}:${p.priceYen}:${p.active}`}
              product={p}
              canEdit={canEdit}
              first={i === 0}
              last={i === products.length - 1}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onSave={(body) => run(() => saveProduct(p.id, body), "保存しました")}
              onDelete={() => {
                if (!window.confirm(`「${p.name}」を削除しますか？\n（施術歴に記録した内容はそのまま残ります）`)) return;
                run(() => deleteProduct(p.id), "削除しました");
              }}
            />
          ))}
          {canEdit && (
            <tr className={styles.addRow}>
              <td />
              <td>
                <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="例：ゼオスキン ミラミン" aria-label="新しい名前" />
              </td>
              <td>
                <select className={styles.input} value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)} aria-label="新しい種類">
                  <option value="skincare">スキンケア</option>
                  <option value="oral">内服</option>
                </select>
              </td>
              <td>
                <input className={styles.input} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" placeholder="例：12100" aria-label="新しい価格" aria-invalid={priceVal === undefined || undefined} />
              </td>
              <td />
              <td />
              <td>
                <button
                  className={styles.primary}
                  disabled={!name.trim() || priceVal === undefined}
                  onClick={() =>
                    run(async () => {
                      await saveProduct(null, { name, category, priceYen: priceVal ?? null });
                      setName("");
                      setPrice("");
                    }, "追加しました")
                  }
                >
                  追加
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function ProductRow(props: {
  product: Product;
  canEdit: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onSave: (body: Partial<Pick<Product, "name" | "category" | "priceYen" | "active">>) => void;
  onDelete: () => void;
}) {
  const { product: p, canEdit } = props;
  const [name, setName] = useState(p.name);
  const [category, setCategory] = useState<ProductCategory>(p.category);
  const [price, setPrice] = useState(yen(p.priceYen));
  const priceVal = parseYen(price);
  const dirty = name !== p.name || category !== p.category || priceVal !== p.priceYen;
  return (
    <tr data-inactive={!p.active || undefined}>
      <td className={styles.orderCol}>
        {canEdit && (
          <>
            <button className={styles.arrow} onClick={props.onUp} disabled={props.first} aria-label="上へ">
              ▲
            </button>
            <button className={styles.arrow} onClick={props.onDown} disabled={props.last} aria-label="下へ">
              ▼
            </button>
          </>
        )}
      </td>
      <td>
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={!canEdit} aria-label="名前" />
      </td>
      <td>
        <select className={styles.input} value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)} disabled={!canEdit} aria-label="種類">
          {(["skincare", "oral"] as const).map((c) => (
            <option key={c} value={c}>
              {PRODUCT_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          className={styles.input}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="numeric"
          disabled={!canEdit}
          aria-label="価格"
          aria-invalid={priceVal === undefined || undefined}
        />
      </td>
      <td>
        <label className={styles.toggle}>
          <input type="checkbox" checked={p.active} disabled={!canEdit} onChange={(e) => props.onSave({ active: e.target.checked })} />
          {p.active ? "出す" : "しばらく出さない"}
        </label>
      </td>
      <td>
        {canEdit && (
          <button className={styles.btn} disabled={!dirty || !name.trim() || priceVal === undefined} onClick={() => props.onSave({ name, category, priceYen: priceVal ?? null })}>
            保存
          </button>
        )}
      </td>
      <td>
        {canEdit && (
          <button className={styles.btn} onClick={props.onDelete}>
            削除
          </button>
        )}
      </td>
    </tr>
  );
}
