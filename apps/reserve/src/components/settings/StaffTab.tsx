"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEntry, StaffPublic, StaffRole } from "@/lib/domain/types";
import { ROLE_LABEL, STAFF_ROLES } from "@/lib/domain/types";
import { fetchAudit, fetchStaff, saveStaff } from "@/components/calendar/api";
import styles from "./settings.module.css";
import { patientPath, withBase } from "@/lib/paths";

interface Props {
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}

/** スタッフの追加・役割変更・利用停止・PIN再設定（院長・管理者のみ） */
export function StaffTab({ notify, fail }: Props) {
  const [items, setItems] = useState<StaffPublic[] | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("nurse");
  const [pin, setPin] = useState("");

  const load = useCallback(async () => {
    try {
      setItems(await fetchStaff());
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    // 初回の読み込み
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const update = async (id: string, body: Parameters<typeof saveStaff>[1], msg: string) => {
    try {
      await saveStaff(id, body);
      notify(msg);
    } catch (err) {
      fail(err);
    }
    await load();
  };

  return (
    <section>
      <p className={styles.lead}>
        スタッフごとにPINでログインし、予約や患者情報の変更は「誰が」行ったかが記録されます。
        PINの変更・利用停止・役割の変更をすると、その人のログインは切れます。
        「管理操作」にチェックがある人は、レーン・メニュー・スキンケア＆内服・料金表などの設定の変更や、予約の取り消し・見積書や同意書の控えの削除ができます
        （最初は院長・管理者と受付だけ。院長・管理者は常にできます）。
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>名前</th>
            <th>役割</th>
            <th>状態</th>
            <th>管理操作</th>
            <th>PIN</th>
          </tr>
        </thead>
        <tbody>
          {items?.map((s) => (
            <tr key={s.id} data-inactive={!s.active || undefined}>
              <td>
                <input
                  className={styles.input}
                  defaultValue={s.name}
                  maxLength={30}
                  aria-label="名前"
                  onBlur={(e) => e.target.value.trim() !== s.name && update(s.id, { name: e.target.value }, "名前を変更しました")}
                />
              </td>
              <td>
                <select
                  className={styles.input}
                  value={s.role}
                  onChange={(e) => update(s.id, { role: e.target.value as StaffRole }, "役割を変更しました")}
                  aria-label="役割"
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => update(s.id, { active: e.target.checked }, e.target.checked ? "利用を再開しました" : "利用を停止しました")}
                  />
                  {s.active ? "利用中" : "停止中"}
                </label>
              </td>
              <td>
                <label className={styles.toggle} title="設定の変更・削除などができるか">
                  <input
                    type="checkbox"
                    checked={s.canManage}
                    disabled={s.role === "admin"}
                    aria-label={`${s.name}の管理操作`}
                    onChange={(e) => update(s.id, { canManage: e.target.checked }, e.target.checked ? "管理操作を許可しました" : "管理操作をできないようにしました")}
                  />
                  {s.role === "admin" ? "常に可" : s.canManage ? "できる" : "見るだけ"}
                </label>
              </td>
              <td>
                <button
                  className={styles.btn}
                  onClick={() => {
                    const next = window.prompt(`${s.name} の新しいPIN（6〜8桁の数字）`);
                    if (next) update(s.id, { pin: next }, "PINを変更しました");
                  }}
                >
                  PINを変更
                </button>
              </td>
            </tr>
          ))}
          <tr className={styles.addRow}>
            <td>
              <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：看護師 佐藤" maxLength={30} aria-label="新しいスタッフの名前" />
            </td>
            <td>
              <select className={styles.input} value={role} onChange={(e) => setRole(e.target.value as StaffRole)} aria-label="新しいスタッフの役割">
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <input
                className={styles.input}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="初期PIN（6〜8桁）"
                inputMode="numeric"
                aria-label="初期PIN"
              />
            </td>
            <td />
            <td>
              <button
                className={styles.primary}
                disabled={!name.trim() || pin.length < 4}
                onClick={async () => {
                  try {
                    await saveStaff(null, { name, role, pin });
                    setName("");
                    setPin("");
                    notify("スタッフを追加しました");
                    await load();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                追加
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** 操作ログ（誰が・いつ・何をしたか）。院長・管理者のみ */
export function AuditTab({ fail }: { fail: (err: unknown) => void }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    fetchAudit().then(setItems, fail);
  }, [fail]);
  return (
    <section>
      <p className={styles.lead}>ログイン・予約・患者情報・設定の操作を新しい順に表示します（直近300件）。患者情報の中身は記録しません。</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>日時</th>
              <th>スタッフ</th>
              <th>操作</th>
              <th>対象</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((a, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>
                  {new Date(a.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </td>
                <td>{a.actor.name}</td>
                <td>{a.action}</td>
                <td>
                  {a.target?.startsWith("p-") ? <a href={withBase(patientPath(a.target))}>患者を開く</a> : a.target ?? ""}
                </td>
              </tr>
            ))}
            {items?.length === 0 && (
              <tr>
                <td colSpan={4}>まだ操作はありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
