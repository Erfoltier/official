"use client";

import { useState } from "react";
import type { ClinicSettings, PaperSize, ThemeId } from "@/lib/domain/types";
import { DEFAULT_ESTIMATE_NOTE, DEFAULT_ESTIMATE_VALID_DAYS, THEMES } from "@/lib/domain/types";
import { applyTheme } from "@/lib/theme";
import { formatHm } from "@/lib/domain/time";
import { saveClinic } from "@/components/calendar/api";
import styles from "./settings.module.css";

const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

/** 院名・診療時間（カレンダーに出す時間帯）・予約の刻み */
export function ClinicTab({
  clinic,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [name, setName] = useState(clinic.name);
  const [start, setStart] = useState(toHm(clinic.dayStartMin));
  const [end, setEnd] = useState(toHm(clinic.dayEndMin === 1440 ? 1435 : clinic.dayEndMin));
  const [slot, setSlot] = useState(clinic.slotMin);
  const [busy, setBusy] = useState(false);

  const s = start ? fromHm(start) : NaN;
  const e = end ? fromHm(end) : NaN;
  const valid = Number.isFinite(s) && Number.isFinite(e) && e - s >= 60 && s % 5 === 0 && e % 5 === 0 && name.trim() !== "";
  const changed = name !== clinic.name || s !== clinic.dayStartMin || e !== clinic.dayEndMin || slot !== clinic.slotMin;

  const save = async () => {
    setBusy(true);
    try {
      await saveClinic({ name, dayStartMin: s, dayEndMin: e, slotMin: slot });
      await onChanged();
      notify("診療時間を保存しました。カレンダーに反映されます");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.clinic}>
      <p className={styles.lead}>
        カレンダーに表示する時間帯と、予約を入れるときの時間の刻みです。院ごとに変えられます。
        時間外に入っている予約も、カレンダーには表示されます。
      </p>
      <div className={styles.clinicCard}>
        <label className={styles.field}>
          <span>院名</span>
          <input className={styles.input} value={name} maxLength={40} onChange={(ev) => setName(ev.target.value)} disabled={!canEdit} />
        </label>
        <div className={styles.timeRow}>
          <label className={styles.field}>
            <span>開院時間</span>
            <input className={styles.input} type="time" step={300} value={start} onChange={(ev) => setStart(ev.target.value)} disabled={!canEdit} />
          </label>
          <span className={styles.timeSep}>〜</span>
          <label className={styles.field}>
            <span>閉院時間</span>
            <input className={styles.input} type="time" step={300} value={end} onChange={(ev) => setEnd(ev.target.value)} disabled={!canEdit} />
          </label>
        </div>
        <label className={styles.field}>
          <span>予約の刻み</span>
          <select className={styles.input} value={slot} onChange={(ev) => setSlot(Number(ev.target.value))} disabled={!canEdit}>
            {[5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m}分
              </option>
            ))}
          </select>
        </label>
        <p className={styles.hint} data-invalid={!valid || undefined}>
          {valid
            ? `カレンダーに ${formatHm(s)}〜${formatHm(e)}（${Math.round(((e - s) / 60) * 10) / 10}時間）を表示し、${slot}分刻みで予約を入れます`
            : "閉院時間は開院時間の1時間以上あとにしてください（5分単位）"}
        </p>
        {canEdit && (
          <div className={styles.actions}>
            <button className={styles.primary} onClick={save} disabled={!valid || !changed || busy}>
              保存
            </button>
          </div>
        )}
      </div>

      <DocumentCard clinic={clinic} canEdit={canEdit} onChanged={onChanged} notify={notify} fail={fail} />
    </section>
  );
}

/** 画面の配色（院で1つ。押すとすぐ全員の画面に反映される）。設定の「画面の表示・配色」タブに出す */
export function ThemeCard({
  clinic,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const current: ThemeId = clinic.theme ?? "default";
  const [busy, setBusy] = useState(false);
  const pick = async (id: ThemeId) => {
    if (id === current || busy) return;
    setBusy(true);
    applyTheme(id);
    try {
      await saveClinic({ theme: id });
      await onChanged();
      notify("配色を変えました。ほかの端末も、次に画面を開いたときに変わります");
    } catch (err) {
      applyTheme(current);
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>画面の配色</h3>
      <p className={styles.hint}>院の好みに合わせて選べます。見積書・同意書など印刷する書類の色は変わりません。</p>
      <div className={styles.themeList} role="radiogroup" aria-label="画面の配色">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === current}
            className={styles.themeOpt}
            disabled={!canEdit || busy}
            onClick={() => pick(t.id)}
          >
            <span className={styles.themeSwatch} style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
            <span>
              <b>{t.label}</b>
              <small>{t.note}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 見積書・同意書に載せる院の情報と、見積書の注意書き */
function DocumentCard({
  clinic,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [docName, setDocName] = useState(clinic.docName ?? "");
  const [address, setAddress] = useState(clinic.address ?? "");
  const [phone, setPhone] = useState(clinic.phone ?? "");
  const [issuer, setIssuer] = useState(clinic.issuer ?? "");
  const [days, setDays] = useState(String(clinic.estimateValidDays ?? DEFAULT_ESTIMATE_VALID_DAYS));
  const [note, setNote] = useState(clinic.estimateNote ?? DEFAULT_ESTIMATE_NOTE);
  const [paper, setPaper] = useState<PaperSize>(clinic.estimatePaper ?? "A4");
  const [busy, setBusy] = useState(false);
  const daysNum = Number(days.normalize("NFKC"));
  const valid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365;
  const changed =
    docName !== (clinic.docName ?? "") ||
    address !== (clinic.address ?? "") ||
    phone !== (clinic.phone ?? "") ||
    issuer !== (clinic.issuer ?? "") ||
    daysNum !== (clinic.estimateValidDays ?? DEFAULT_ESTIMATE_VALID_DAYS) ||
    note !== (clinic.estimateNote ?? DEFAULT_ESTIMATE_NOTE) ||
    paper !== (clinic.estimatePaper ?? "A4");

  const save = async () => {
    setBusy(true);
    try {
      await saveClinic({ docName, address, phone, issuer, estimateValidDays: daysNum, estimateNote: note, estimatePaper: paper });
      await onChanged();
      notify("書類に載せる院の情報を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>見積書・同意書に載せる院の情報</h3>
      <label className={styles.field}>
        <span>書類に載せる院名（空欄なら院名「{clinic.name}」）</span>
        <input className={styles.input} value={docName} maxLength={60} onChange={(ev) => setDocName(ev.target.value)} disabled={!canEdit} placeholder="例：いしだ美容皮膚科" />
      </label>
      <label className={styles.field}>
        <span>住所</span>
        <input className={styles.input} value={address} maxLength={120} onChange={(ev) => setAddress(ev.target.value)} disabled={!canEdit} placeholder="例：東京都○○区○○1-2-3 ○○ビル2F" />
      </label>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>電話番号（空欄なら載せない）</span>
          <input className={styles.input} value={phone} maxLength={30} onChange={(ev) => setPhone(ev.target.value)} disabled={!canEdit} inputMode="tel" />
        </label>
        <label className={styles.field}>
          <span>発行者・医師名（空欄なら載せない）</span>
          <input className={styles.input} value={issuer} maxLength={60} onChange={(ev) => setIssuer(ev.target.value)} disabled={!canEdit} placeholder="例：院長 石田 ○○" />
        </label>
      </div>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>見積書の有効期限（発行日から何日）</span>
          <input className={styles.input} value={days} inputMode="numeric" onChange={(ev) => setDays(ev.target.value)} disabled={!canEdit} style={{ maxWidth: "8em" }} />
        </label>
        <label className={styles.field}>
          <span>見積書の用紙（印刷時にも切り替え可）</span>
          <select className={styles.input} value={paper} onChange={(ev) => setPaper(ev.target.value as PaperSize)} disabled={!canEdit}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
        </label>
      </div>
      <p className={styles.hint}>同意書の用紙は A4 です。</p>
      <label className={styles.field}>
        <span>見積書の注意書き（リスク・副作用・個人差など。すべての見積書の下に入ります）</span>
        <textarea className={styles.input} value={note} rows={6} maxLength={2000} onChange={(ev) => setNote(ev.target.value)} disabled={!canEdit} />
      </label>
      <p className={styles.hint} data-invalid={!valid || undefined}>
        {valid ? "自由診療の見積書には、費用のほかリスク・副作用の説明を添えるのが一般的です。院の言葉に書き換えてください。" : "有効期限は1〜365日で入れてください"}
      </p>
      {canEdit && (
        <div className={styles.actions}>
          <button className={styles.primary} onClick={save} disabled={!valid || !changed || busy}>
            保存
          </button>
        </div>
      )}
    </div>
  );
}
