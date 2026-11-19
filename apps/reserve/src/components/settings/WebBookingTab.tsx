"use client";

import type { ClinicSettings, Lane, Menu } from "@/lib/domain/types";
import { TattooCard } from "./ClinicTab";
import styles from "./settings.module.css";

/** 設定の「Web予約設定」タブ：患者が自分で予約するページの設定。いまは日曜予約設定（タトゥー・アートメイク除去と日曜メニュー）だけ */
export function WebBookingTab({
  clinic,
  lanes,
  menus,
  tattoo,
  mail,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  lanes: Lane[];
  menus: Menu[];
  tattoo?: { url: string; lineUrl?: string; preview?: string };
  mail?: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  return (
    <section className={styles.clinic}>
      <p className={styles.lead}>患者が自分で日時を選んで予約するページの設定です。</p>
      <h3 className={styles.subTitle}>日曜予約設定</h3>
      <div className={styles.webBooking}>
        <TattooCard clinic={clinic} lanes={lanes} menus={menus} info={tattoo} mail={mail} canEdit={canEdit} onChanged={onChanged} notify={notify} fail={fail} />
      </div>
    </section>
  );
}
