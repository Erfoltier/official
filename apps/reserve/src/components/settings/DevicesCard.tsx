"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchDevices, fetchSecurity, saveSecurity, setDeviceStatus, type DeviceEntry } from "@/components/calendar/api";
import styles from "./settings.module.css";

const STATUS: Record<DeviceEntry["status"], string> = { approved: "承認済", pending: "承認待ち", blocked: "使用停止" };
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** 設定 → スタッフ：登録した端末だけで使う（院長・管理者） */
export function DevicesCard({ notify, fail }: { notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [items, setItems] = useState<DeviceEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const [sec, list] = await Promise.all([fetchSecurity(), fetchDevices()]);
      setOn(sec.requireDevice);
      setItems(list.items);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    // 開いたときに読み込む
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const act = async (d: DeviceEntry, action: "approve" | "block" | "pending" | "delete", msg: string, label?: string) => {
    try {
      await setDeviceStatus(d.id, action, label);
      notify(msg);
    } catch (err) {
      fail(err);
    }
    await load();
  };

  if (on === null) return null;
  return (
    <>
      <h3 className={styles.subhead}>登録した端末</h3>
      <div className={styles.actions} style={{ justifyContent: "flex-start" }}>
        <label>
          <input
            type="checkbox"
            checked={on}
            onChange={async (e) => {
              const next = e.target.checked;
              if (next && !window.confirm("登録した端末だけで使えるようにします。この端末はその場で承認されます。ほかの端末は、次にログインしたときに「承認待ち」になり、ここで承認するまで使えません。よろしいですか？")) return;
              try {
                setOn((await saveSecurity({ requireDevice: next })).requireDevice);
                notify(next ? "登録した端末だけで使うようにしました" : "どの端末からでも使えるようにしました");
              } catch (err) {
                fail(err);
              }
              await load();
            }}
          />{" "}
          <b>登録した端末だけで使う</b>
        </label>
        <span className={styles.muted}>院の端末以外からのログインを防ぎます。ブラウザのデータ（Cookie）を消した端末は、もう一度承認が必要です。</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>端末</th>
              <th>状態</th>
              <th>最後に使ったスタッフ・日時</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.label}
                  {d.current && <span className={styles.muted}>（この端末）</span>}
                </td>
                <td style={{ whiteSpace: "nowrap", color: d.status === "pending" ? "var(--danger, #c0392b)" : undefined, fontWeight: d.status === "pending" ? 700 : undefined }}>{STATUS[d.status]}</td>
                <td>
                  {d.lastStaff?.name ?? "—"}
                  <div className={styles.muted}>{when(d.lastSeen)}</div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {d.status !== "approved" && (
                    <button className={styles.primary} onClick={() => act(d, "approve", "端末を承認しました")}>
                      承認
                    </button>
                  )}
                  {d.status === "approved" && !d.current && (
                    <button className={styles.btn} onClick={() => window.confirm(`「${d.label}」を使用停止にします。よろしいですか？`) && act(d, "block", "端末を使用停止にしました")}>
                      使用停止
                    </button>
                  )}
                  <button
                    className={styles.btn}
                    onClick={() => {
                      const label = window.prompt("この端末の名前（例：受付のパソコン、診察室の iPad）", d.label);
                      if (label && label.trim()) act(d, d.status === "approved" ? "approve" : d.status === "blocked" ? "block" : "pending", "名前を変えました", label.trim());
                    }}
                  >
                    名前
                  </button>
                  {!d.current && (
                    <button className={styles.btn} onClick={() => window.confirm(`「${d.label}」を一覧から削除します。よろしいですか？`) && act(d, "delete", "削除しました")}>
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4}>まだ端末の記録はありません（ログインした端末がここに出ます）</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
