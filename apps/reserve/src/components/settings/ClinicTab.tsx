"use client";

import { useState, type ReactNode } from "react";
import type { ClinicSettings, Lane, Menu, PaperSize, SundayMenu, ThemeId } from "@/lib/domain/types";
import { DEFAULT_ESTIMATE_NOTE, DEFAULT_ESTIMATE_VALID_DAYS, THEMES } from "@/lib/domain/types";
import { applyTheme } from "@/lib/theme";
import { formatHm } from "@/lib/domain/time";
import { saveClinic, type HomepageDays } from "@/components/calendar/api";
import styles from "./settings.module.css";

const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromHm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

/** 院名・診療時間（カレンダーに出す時間帯）・予約の刻み */
export function ClinicTab({
  clinic,
  lanes,
  homepageDays,
  onlineCs,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  lanes: Lane[];
  homepageDays?: HomepageDays;
  onlineCs?: { url: string; mail: boolean };
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
      notify("院名・診療時間を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.clinic}>
      <p className={styles.lead}>
        院名と、カレンダーに表示する時間帯・予約の刻みを設定します。診療時間外の予約もカレンダーに表示されます。
      </p>
      <div className={styles.clinicMasonry}>
      <div className={styles.clinicCard}>
        <h3 className={styles.cardTitle}>院名・診療時間</h3>
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
            ? `カレンダーに ${formatHm(s)}〜${formatHm(e)}（${Math.round(((e - s) / 60) * 10) / 10}時間）を表示し、${slot}分刻みで予約を受け付けます`
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
      <PublicCard clinic={clinic} homepageDays={homepageDays} canEdit={canEdit} onChanged={onChanged} notify={notify} fail={fail} />
      <OnlineCsCard clinic={clinic} lanes={lanes} info={onlineCs} canEdit={canEdit} onChanged={onChanged} notify={notify} fail={fail} />
      </div>
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
      notify("配色を変更しました。ほかの端末には、次に画面を開いたときに反映されます");
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
      <p className={styles.hint}>見積書・同意書など、印刷する書類の色は変わりません。</p>
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
      notify("書類に記載する院の情報を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>見積書・同意書に記載する院の情報</h3>
      <label className={styles.field}>
        <span>書類に記載する院名（空欄の場合は「{clinic.name}」）</span>
        <input className={styles.input} value={docName} maxLength={60} onChange={(ev) => setDocName(ev.target.value)} disabled={!canEdit} placeholder="例：○○美容皮膚科" />
      </label>
      <label className={styles.field}>
        <span>住所</span>
        <input className={styles.input} value={address} maxLength={120} onChange={(ev) => setAddress(ev.target.value)} disabled={!canEdit} placeholder="例：東京都○○区○○1-2-3 ○○ビル2F" />
      </label>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>電話番号（空欄の場合は記載なし）</span>
          <input className={styles.input} value={phone} maxLength={30} onChange={(ev) => setPhone(ev.target.value)} disabled={!canEdit} inputMode="tel" />
        </label>
        <label className={styles.field}>
          <span>発行者・医師名（空欄の場合は記載なし）</span>
          <input className={styles.input} value={issuer} maxLength={60} onChange={(ev) => setIssuer(ev.target.value)} disabled={!canEdit} placeholder="例：院長 山田 ○○" />
        </label>
      </div>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>見積書の有効期限（発行日からの日数）</span>
          <input className={styles.input} value={days} inputMode="numeric" onChange={(ev) => setDays(ev.target.value)} disabled={!canEdit} style={{ maxWidth: "8em" }} />
        </label>
        <label className={styles.field}>
          <span>見積書の用紙サイズ</span>
          <select className={styles.input} value={paper} onChange={(ev) => setPaper(ev.target.value as PaperSize)} disabled={!canEdit}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
        </label>
      </div>
      <p className={styles.hint}>見積書の用紙は印刷時にも切り替えられます。同意書は A4 で印刷します。</p>
      <label className={styles.field}>
        <span>見積書の注意書き</span>
        <textarea className={styles.input} value={note} rows={6} maxLength={2000} onChange={(ev) => setNote(ev.target.value)} disabled={!canEdit} />
      </label>
      <p className={styles.hint} data-invalid={!valid || undefined}>
        {valid ? "すべての見積書の末尾に入ります。自由診療の見積書には、費用のほかリスク・副作用・個人差の説明を添えるのが一般的です。" : "有効期限は1〜365日で入力してください"}
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

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

/** 患者向けの表示（LINE の予約申請フォーム・問診票の見出し・プライバシーポリシー）と、予約申請フォームで選べる日 */
function PublicCard({
  clinic,
  homepageDays,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  homepageDays?: HomepageDays;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [publicName, setPublicName] = useState(clinic.publicName ?? "");
  const [publicNameEn, setPublicNameEn] = useState(clinic.publicNameEn ?? "");
  const [department, setDepartment] = useState(clinic.department ?? "");
  const [privacyUrl, setPrivacyUrl] = useState(clinic.privacyUrl ?? "");
  const [homepageUrl, setHomepageUrl] = useState(clinic.homepageUrl ?? "");
  const [accessUrl, setAccessUrl] = useState(clinic.accessUrl ?? "");
  const [hours, setHours] = useState(clinic.intakeHours ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(clinic.intakeWeekdays ?? [0, 1, 2, 3, 4, 5, 6]);
  const [special, setSpecial] = useState((clinic.intakeSpecialDates ?? []).join("\n"));
  const [counseling, setCounseling] = useState(!!clinic.intakeCounseling);
  const [busy, setBusy] = useState(false);
  const dates = special
    .split(/[\s,、]+/)
    .map((d) => d.trim().replace(/\//g, "-"))
    .filter(Boolean);
  const badDate = dates.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
  const badUrl = [privacyUrl, homepageUrl, accessUrl].some((u) => u.trim() !== "" && !/^https:\/\/\S+$/.test(u.trim()));
  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));

  const save = async () => {
    setBusy(true);
    try {
      await saveClinic({
        publicName,
        publicNameEn,
        department,
        privacyUrl: privacyUrl.trim(),
        homepageUrl: homepageUrl.trim(),
        accessUrl: accessUrl.trim(),
        intakeHours: hours,
        intakeWeekdays: weekdays,
        intakeSpecialDates: dates,
        intakeCounseling: counseling,
      });
      await onChanged();
      notify("患者向けの表示を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>患者向けの表示・LINE の予約申請フォーム</h3>
      <p className={styles.hint}>LINE の予約申請フォームと問診票の見出し、予約申請フォームで選べる日に使います。</p>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>正式な院名（空欄の場合は書類の院名か院名）</span>
          <input className={styles.input} value={publicName} maxLength={60} onChange={(ev) => setPublicName(ev.target.value)} disabled={!canEdit} placeholder="例：○○皮フ科／美容皮膚科" />
        </label>
        <label className={styles.field}>
          <span>英語の院名（空欄の場合は出しません）</span>
          <input className={styles.input} value={publicNameEn} maxLength={80} onChange={(ev) => setPublicNameEn(ev.target.value)} disabled={!canEdit} placeholder="例：○○ Dermatology" />
        </label>
      </div>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>予約申請を受け付ける診療科（空欄なら院全体）</span>
          <input className={styles.input} value={department} maxLength={30} onChange={(ev) => setDepartment(ev.target.value)} disabled={!canEdit} placeholder="例：美容皮膚科" />
        </label>
        <label className={styles.field}>
          <span>ホームページのアドレス</span>
          <input className={styles.input} value={homepageUrl} maxLength={300} onChange={(ev) => setHomepageUrl(ev.target.value)} disabled={!canEdit} placeholder="https://" inputMode="url" />
        </label>
      </div>
      <label className={styles.field}>
        <span>プライバシーポリシーのアドレス</span>
        <input className={styles.input} value={privacyUrl} maxLength={300} onChange={(ev) => setPrivacyUrl(ev.target.value)} disabled={!canEdit} placeholder="https://" inputMode="url" />
      </label>
      <label className={styles.field}>
        <span>アクセスのページのアドレス（予約確定の案内に住所の代わりに出す。空欄なら住所）</span>
        <input className={styles.input} value={accessUrl} maxLength={300} onChange={(ev) => setAccessUrl(ev.target.value)} disabled={!canEdit} placeholder="https://" inputMode="url" />
      </label>
      <label className={styles.field}>
        <span>受付日時の案内（予約申請フォームの見出しに出す。改行できます）</span>
        <textarea className={styles.input} value={hours} rows={2} maxLength={120} onChange={(ev) => setHours(ev.target.value)} disabled={!canEdit} placeholder={"例：水曜日・祝日特別診療日\n10:00〜18:30"} />
      </label>
      <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
        <span>予約申請フォームで選べる曜日</span>
        <div className={styles.actions} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          {WEEKDAY_NAMES.map((n, d) => (
            <label key={d} className={styles.chip}>
              <input type="checkbox" checked={weekdays.includes(d)} onChange={() => toggleDay(d)} disabled={!canEdit} /> {n}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={styles.field}>
        <span>そのほかに選べる特別診療日（1行に1日、例：2026-11-03）</span>
        <textarea className={styles.input} value={special} rows={4} onChange={(ev) => setSpecial(ev.target.value)} disabled={!canEdit} />
      </label>
      <HomepageDaysView hp={homepageDays} homepageUrl={clinic.homepageUrl ?? ""} />
      <label className={styles.field} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
        <input type="checkbox" style={{ marginTop: 3, flexShrink: 0 }} checked={counseling} onChange={(ev) => setCounseling(ev.target.checked)} disabled={!canEdit} />
        <span>受診区分に「カウンセリング（ゼオスキン）」を出す（シミクレール運営会社との個人情報の共同利用への同意つき。文言の確認が済んでから有効にしてください）</span>
      </label>
      <p className={styles.hint} data-invalid={badDate || badUrl || undefined}>
        {badDate ? `日付の形が正しくありません：${badDate}` : badUrl ? "アドレスは https:// で始まる形で入力してください" : "プライバシーポリシーは、予約申請フォームの同意の画面に出ます。"}
      </p>
      {canEdit && (
        <div className={styles.actions}>
          <button className={styles.primary} onClick={save} disabled={!!badDate || badUrl || busy}>
            保存
          </button>
        </div>
      )}
    </div>
  );
}

const md = (iso: string) => {
  const d = new Date(`${iso}T00:00:00+09:00`);
  return `${d.getMonth() + 1}/${d.getDate()}（${"日月火水木金土"[d.getDay()]}）`;
};

/** ホームページの「特別診療日」から読んだ日（1日1回。手で入れた日と合わせて予約申請フォームに出す。祝日は自動では足さない） */
function HomepageDaysView({ hp, homepageUrl }: { hp?: HomepageDays; homepageUrl: string }) {
  if (!homepageUrl) return <p className={styles.hint}>ホームページのアドレスを入れると、トップの「特別診療日」を1日1回読み、予約申請フォームで選べる日に自動で足します。</p>;
  const when = hp?.checkedAt ? new Date(hp.checkedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className={styles.hint}>
      <b>ホームページから読んだ特別診療日</b>（1日1回自動。上に手で入れた日と合わせてフォームに出ます。祝日は自動では足しません）
      <br />
      {!hp?.checkedAt ? (
        "まだ読んでいません（次の定期実行で読みます）"
      ) : (hp.upcoming ?? []).length ? (
        (hp.upcoming ?? []).map(md).join("・")
      ) : (
        "今日以降の日はありません"
      )}
      {when && `　（最後に確かめた日時：${when}）`}
      {hp?.error && (
        <span style={{ display: "block", color: "var(--danger, #c0392b)" }}>
          ホームページから読めませんでした：{hp.error}（前回読めた日をそのまま使っています）
        </span>
      )}
      {hp?.skipped && hp.skipped.length > 0 && (
        <span style={{ display: "block", color: "var(--danger, #c0392b)" }}>曜日が合わないなどで取り込まなかった日：{hp.skipped.join("、")}</span>
      )}
    </div>
  );
}

/** オンラインカウンセリングの Web 予約：受け付けるか・レーン・開ける日時（行を消せば閉じる） */
function OnlineCsCard({
  clinic,
  lanes,
  info,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  lanes: Lane[];
  info?: { url: string; mail: boolean };
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [enabled, setEnabled] = useState(!!clinic.onlineCsEnabled);
  const [laneId, setLaneId] = useState(clinic.onlineCsLaneId ?? "");
  const [text, setText] = useState((clinic.onlineCsSlots ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bad = lines.find((l) => !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}\s*[-〜～]\s*\d{1,2}:\d{2}$/.test(l));
  const save = async () => {
    setBusy(true);
    try {
      await saveClinic({ onlineCsEnabled: enabled, onlineCsLaneId: laneId, onlineCsSlots: lines });
      await onChanged();
      notify("オンラインカウンセリングの設定を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>オンラインカウンセリング（Web予約）</h3>
      <p className={styles.hint}>
        開ける日時を1行に1つ入れると、その中のレーンの空いている15分枠を、お客様が予約ページで選んで予約できます（その場で予約表に入り、確定のメールを送ります）。閉じるときは行を消して保存します。
      </p>
      <label className={styles.field} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <input type="checkbox" style={{ marginTop: 3, flexShrink: 0 }} checked={enabled} onChange={(ev) => setEnabled(ev.target.checked)} disabled={!canEdit} />
        <span>予約ページで受け付ける（共同利用の同意文の確認が済んでから有効にしてください）</span>
      </label>
      <label className={styles.field}>
        <span>レーン（予約表ではふだん畳んで、ボタンで開きます）</span>
        <select className={styles.input} value={laneId} onChange={(ev) => setLaneId(ev.target.value)} disabled={!canEdit}>
          <option value="">（選ばない）</option>
          {lanes
            .filter((l) => l.active || l.id === laneId)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>受付日時（1行に1つ、例：2026-11-20 14:00-16:00）</span>
        <textarea className={styles.input} value={text} rows={4} onChange={(ev) => setText(ev.target.value)} disabled={!canEdit} />
      </label>
      <p className={styles.hint} data-invalid={bad || (enabled && info && !info.mail) || undefined}>
        {bad
          ? `受付日時の形が正しくありません：${bad}`
          : info && !info.mail
            ? "メールの送信元が未設定のため、確定のメールを送れません（設定 → リマインド）。"
            : info?.url
              ? `予約ページ：${info.url}`
              : "予約ページは、問診票のアドレスと同じサイトの /cs/ です。"}
      </p>
      {canEdit && (
        <div className={styles.actions}>
          <button className={styles.primary} onClick={save} disabled={!!bad || busy}>
            保存
          </button>
        </div>
      )}
    </div>
  );
}

/** タトゥー・アートメイク除去（日曜）の Web 予約：受け付けるか・照射と初診説明のレーンとメニュー・開ける日時（行を消せば閉じる） */
export function TattooCard({
  clinic,
  lanes,
  menus,
  info,
  mail,
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  lanes: Lane[];
  menus: Menu[];
  info?: { url: string; lineUrl?: string };
  mail?: boolean;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}) {
  const [enabled, setEnabled] = useState(!!clinic.tattooEnabled);
  const [laneId, setLaneId] = useState(clinic.tattooLaneId ?? "");
  const [menuId, setMenuId] = useState(clinic.tattooMenuId ?? "");
  const [explainLaneId, setExplainLaneId] = useState(clinic.tattooExplainLaneId ?? "");
  const [explainMenuId, setExplainMenuId] = useState(clinic.tattooExplainMenuId ?? "");
  const [text, setText] = useState((clinic.tattooSlots ?? []).join("\n"));
  const [liffId, setLiffId] = useState(clinic.tattooLiffId ?? "");
  const [machine, setMachine] = useState(clinic.tattooMachine ?? "");
  const [items, setItems] = useState<SundayMenu[]>(clinic.sundayMenus ?? []);
  const [tattooOn, setTattooOn] = useState(clinic.tattooKindOn !== false);
  const [artmakeOn, setArtmakeOn] = useState(clinic.artmakeKindOn !== false);
  const [order, setOrder] = useState<string[]>(clinic.sundayOrder ?? []);
  const [removalCategory, setRemovalCategory] = useState(clinic.removalCategory ?? "");
  const [busy, setBusy] = useState(false);
  const badItem = items.map(sundayMenuProblem).find(Boolean);
  const badLiff = liffId.trim() !== "" && !/^\d{6,20}-[A-Za-z0-9]{4,40}$/.test(liffId.trim());
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bad = lines.find((l) => !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}\s*[-〜～]\s*\d{1,2}:\d{2}$/.test(l));
  const activeLanes = (id: string) => lanes.filter((l) => l.active || l.id === id);
  const laneMenus = (lane: string, id: string) => menus.filter((m) => (m.active && (m.laneIds ?? []).includes(lane)) || m.id === id);
  // タトゥー・アートメイクをオンにするなら照射のレーンとメニューが要る
  const missing = (tattooOn || artmakeOn) && (!laneId || !menuId);
  const save = async () => {
    setBusy(true);
    try {
      await saveClinic({
        tattooEnabled: enabled,
        tattooLaneId: laneId,
        tattooMenuId: menuId,
        tattooExplainLaneId: explainLaneId,
        tattooExplainMenuId: explainMenuId,
        tattooSlots: lines,
        tattooLiffId: liffId.trim(),
        tattooMachine: machine.trim(),
        tattooKindOn: tattooOn,
        artmakeKindOn: artmakeOn,
        sundayMenus: items,
        sundayOrder: fullOrder(order, items),
        removalCategory: removalCategory.trim(),
      });
      await onChanged();
      notify("日曜の Web 予約の設定を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.clinicCard}>
      <h3 className={styles.cardTitle}>日曜の Web 予約</h3>
      <p className={styles.hint}>
        オンにしたメニューだけが日曜の予約ページに出て、患者がその場で予約できます。選べる時刻は受付日時の中の空きの最初と、後ろに予約がある空きの最後だけ。レーンを2つ以上選ぶと空いているほうに入り、機器の名前が同じメニュー同士は同じ時刻に入りません。
      </p>
      <div className={styles.sundayGrid}>
      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
        <Switch on={enabled} onChange={setEnabled} label="日曜の Web 予約" disabled={!canEdit} />
        日曜の Web 予約
      </div>
      <label className={styles.field}>
        <span>LINE で開くための LIFF ID（LINE Developers で、エンドポイントを予約ページにした LIFF アプリの ID。空なら LINE を使わずメールで確定）</span>
        <input className={styles.input} value={liffId} maxLength={80} onChange={(ev) => setLiffId(ev.target.value)} disabled={!canEdit} placeholder="例：1234567890-AbCdEfGh" />
      </label>
      {info?.lineUrl && <p className={styles.hint}>LINE で開くアドレス：{info.lineUrl}（ホームページのボタン・LINE のメニューに貼る）</p>}
      </div>
      <label className={styles.field}>
        <span>受付日時（全メニューで共通。1行に1つ、例：2026-12-06 10:00-13:00）</span>
        <textarea className={styles.input} value={text} rows={6} onChange={(ev) => setText(ev.target.value)} disabled={!canEdit} />
      </label>
      </div>

      <h4 className={styles.subTitle}>日曜メニュー</h4>
      <SundayMenusEditor items={items} setItems={setItems} lanes={lanes} menus={menus} canEdit={canEdit} order={order} setOrder={setOrder} fixed={[
        {
          key: "tattoo",
          title: "タトゥー除去",
          on: tattooOn,
          setOn: setTattooOn,
          about: `［${removalCategory.trim() || "除去"}］時間は面積で自動（初診は説明10分を足す）`,
          warn: tattooOn && missing,
          detail: (
            <>
                <label className={styles.field}>
                  <span>照射のレーン（タトゥー・アートメイク共通）</span>
                  <select className={styles.input} value={laneId} onChange={(ev) => setLaneId(ev.target.value)} disabled={!canEdit}>
                    <option value="">（選ばない）</option>
                    {activeLanes(laneId).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>照射のメニュー（予約に付ける。照射のレーンで使えるメニュー）</span>
                  <select className={styles.input} value={menuId} onChange={(ev) => setMenuId(ev.target.value)} disabled={!canEdit || !laneId}>
                    <option value="">（選ばない）</option>
                    {laneMenus(laneId, menuId).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>初診説明のレーン（照射の直前の10分。空いていなければ照射のレーンに続けて取ります）</span>
                  <select className={styles.input} value={explainLaneId} onChange={(ev) => setExplainLaneId(ev.target.value)} disabled={!canEdit}>
                    <option value="">（使わない：説明も照射のレーンで取る）</option>
                    {activeLanes(explainLaneId)
                      .filter((l) => l.id !== laneId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
                {explainLaneId && (
                  <label className={styles.field}>
                    <span>初診説明のメニュー（選ばなければ照射のメニューを付けます）</span>
                    <select className={styles.input} value={explainMenuId} onChange={(ev) => setExplainMenuId(ev.target.value)} disabled={!canEdit}>
                      <option value="">（選ばない）</option>
                      {laneMenus(explainLaneId, explainMenuId).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={styles.field}>
                  <span>照射に使う機器の名前（任意。下の日曜メニューで同じ名前を入れたものとは、レーンが違っても同じ時刻に入れません）</span>
                  <input className={styles.input} value={machine} maxLength={30} onChange={(ev) => setMachine(ev.target.value)} disabled={!canEdit} placeholder="例：ピコレーザー" />
                </label>
                <label className={styles.field}>
                  <span>分類（タトゥー・アートメイク除去の両方。予約ページでまず選ぶ分類）</span>
                  <input className={styles.input} value={removalCategory} maxLength={20} list="sunday-cats" onChange={(ev) => setRemovalCategory(ev.target.value)} disabled={!canEdit} placeholder="除去" />
                </label>
            </>
          ),
        },
        {
          key: "artmake",
          title: "アートメイク除去",
          on: artmakeOn,
          setOn: setArtmakeOn,
          about: `［${removalCategory.trim() || "除去"}］時間は面積で自動（眉は左右の合計）`,
          warn: artmakeOn && missing,
          detail: <p className={styles.hint}>照射のレーン・メニュー・初診説明・機器は、タトゥー除去と共通です（タトゥー除去の設定で変えます）。</p>,
        },
      ]} />
      <p className={styles.hint} data-invalid={bad || badLiff || badItem || missing || (enabled && mail === false) || undefined}>
        {badItem
          ? badItem
          : badLiff
          ? "LIFF ID の形が正しくありません（例：1234567890-AbCdEfGh）"
          : bad
          ? `受付日時の形が正しくありません：${bad}`
          : missing
            ? "タトゥー・アートメイク除去をオンにするときは、照射のレーンとメニューを選んでください。"
            : enabled && mail === false
              ? "メールの送信元が未設定のため、確定のメールを送れません（設定 → リマインド）。"
              : info?.url
                ? `予約ページ：${info.url}（院の LINE のメニューなどから開けるようにします）`
                : "予約ページは、問診票のアドレスと同じサイトの /tattoo/ です。"}
      </p>
      {canEdit && (
        <div className={styles.actions}>
          <button className={styles.primary} onClick={save} disabled={!!bad || badLiff || !!badItem || missing || busy}>
            保存
          </button>
        </div>
      )}
    </div>
  );
}

/** 日曜メニューの行の問題（保存できない理由）。なければ空 */
function sundayMenuProblem(it: SundayMenu, i: number): string {
  const label = it.name.trim() || `${i + 1}行目`;
  if (!it.name.trim()) return `日曜メニューの${i + 1}行目：患者に見せる名前を入れてください`;
  const variable = isVariable(it);
  for (const g of it.partGroups ?? []) {
    for (const pt of g.parts) {
      if (!pt.name.trim()) return `「${label}」の部位の名前を入れてください`;
      if (!Number.isInteger(pt.minutes) || pt.minutes < 5 || pt.minutes > 180 || pt.minutes % 5 !== 0) return `「${label}」の部位「${pt.name}」の時間は5〜180分（5分刻み）で入れてください`;
    }
  }
  for (const [k, ja] of [["first", "初診"], ["repeat", "再診"]] as const) {
    const min = it[`${k}Minutes`];
    if (!Number.isInteger(min) || min < 0 || min > 180 || min % 5 !== 0) return `「${label}」の${ja}の時間は0〜180分（5分刻み）で入れてください`;
    if (it.enabled && variable && it[`${k}LaneIds`].length > 0 && !it[`${k}MenuId`]) return `「${label}」の${ja}の予約に付けるメニューを選んでください（受けないときは区分のスイッチをオフに）`;
    if (it.enabled && !variable && min > 0 && (it[`${k}LaneIds`].length === 0 || !it[`${k}MenuId`])) return `「${label}」の${ja}は、レーンと予約に付けるメニューを選んでください（受けないときは区分のスイッチをオフに）`;
  }
  if (it.enabled && it.flow && it.repeatLaneIds.length > 0 && (!it.creamMinutes || !it.injectionMinutes || !(it.anesLaneIds ?? []).length || !it.creamMenuId || !it.neoboMenuId))
    return `「${label}」は、施術の時間（クリーム・注射）、麻酔のレーン、麻酔クリームとネオボのメニューを入れてください（受診したことのある方を受けないときは再診のスイッチをオフに）`;
  for (const v of [it.creamMinutes ?? 0, it.injectionMinutes ?? 0]) if (!Number.isInteger(v) || v < 0 || v > 180 || v % 5 !== 0) return `「${label}」の施術の時間は0〜180分（5分刻み）で入れてください`;
  if (it.enabled && variable && it.firstLaneIds.length === 0 && it.repeatLaneIds.length === 0) return `「${label}」は、初診か再診のレーンを選んでください`;
  if (it.enabled && !variable && it.firstMinutes === 0 && it.repeatMinutes === 0) return `「${label}」は、初診か再診の時間を入れてください`;
  return "";
}

/** 部位ごと・本数で時間が変わるメニューか（そのときの初診・再診の時間は「足す時間」） */
const isVariable = (it: SundayMenu) => (it.partGroups ?? []).length > 0 || (it.countPerMinute ?? 0) > 0 || !!it.flow;
type TimeMode = "fixed" | "parts" | "count" | "flow";
const timeMode = (it: SundayMenu): TimeMode => (it.flow ? "flow" : (it.partGroups ?? []).length > 0 ? "parts" : (it.countPerMinute ?? 0) > 0 ? "count" : "fixed");

/**
 * 部位ごとの時間：区分（男性・女性など）と部位をプルダウンで選び、選んだ部位の名前と分だけを直す（全部を並べると幅が大きくなるため）
 */
function PartsEditor({ it, onChange, canEdit }: { it: SundayMenu; onChange: (groups: NonNullable<SundayMenu["partGroups"]>) => void; canEdit: boolean }) {
  const groups = it.partGroups ?? [];
  const [gi, setGi] = useState(0);
  const [pi, setPi] = useState(0);
  const g = groups[Math.min(gi, groups.length - 1)];
  const gIdx = Math.min(gi, groups.length - 1);
  const pIdx = g ? Math.min(pi, g.parts.length - 1) : -1;
  const part = g && pIdx >= 0 ? g.parts[pIdx] : undefined;
  const setGroups = (next: NonNullable<SundayMenu["partGroups"]>) => onChange(next);
  const putGroup = (patch: Partial<(typeof groups)[number]>) => setGroups(groups.map((x, i) => (i === gIdx ? { ...x, ...patch } : x)));
  const putPart = (patch: Partial<{ name: string; minutes: number }>) => putGroup({ parts: g.parts.map((x, i) => (i === pIdx ? { ...x, ...patch } : x)) });
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className={styles.timeRow}>
        <label className={styles.field}>
          <span>区分（{groups.length}）</span>
          <select className={styles.input} value={gIdx} onChange={(ev) => { setGi(Number(ev.target.value)); setPi(0); }}>
            {groups.map((x, i) => (
              <option key={i} value={i}>
                {x.name}（{x.parts.length}部位）
              </option>
            ))}
          </select>
        </label>
        {g && (
          <label className={styles.field}>
            <span>区分の名前</span>
            <input className={styles.input} value={g.name} maxLength={20} onChange={(ev) => putGroup({ name: ev.target.value })} disabled={!canEdit} />
          </label>
        )}
      </div>
      {g && (
        <div className={styles.timeRow}>
          <label className={styles.field}>
            <span>部位（{g.parts.length}）</span>
            <select className={styles.input} value={pIdx} onChange={(ev) => setPi(Number(ev.target.value))}>
              {g.parts.map((x, i) => (
                <option key={i} value={i}>
                  {x.name}：{x.minutes}分
                </option>
              ))}
            </select>
          </label>
          {part && (
            <>
              <label className={styles.field}>
                <span>部位の名前</span>
                <input className={styles.input} value={part.name} maxLength={30} onChange={(ev) => putPart({ name: ev.target.value })} disabled={!canEdit} />
              </label>
              <label className={styles.field} style={{ maxWidth: 110 }}>
                <span>分</span>
                <input className={styles.input} type="number" min={5} max={180} step={5} value={part.minutes} onChange={(ev) => putPart({ minutes: Number(ev.target.value) || 0 })} disabled={!canEdit} />
              </label>
            </>
          )}
        </div>
      )}
      {canEdit && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {g && (
            <button type="button" onClick={() => { putGroup({ parts: [...g.parts, { name: "新しい部位", minutes: 10 }] }); setPi(g.parts.length); }}>
              部位を足す
            </button>
          )}
          {part && (
            <button type="button" onClick={() => { putGroup({ parts: g.parts.filter((_, i) => i !== pIdx) }); setPi(0); }}>
              この部位を消す
            </button>
          )}
          {groups.length < 4 && (
            <button type="button" onClick={() => { setGroups([...groups, { name: "新しい区分", parts: g ? g.parts.map((x) => ({ ...x })) : [{ name: "新しい部位", minutes: 10 }] }]); setGi(groups.length); setPi(0); }}>
              区分を足す（今の区分の写し）
            </button>
          )}
          {g && groups.length > 1 && (
            <button type="button" onClick={() => { setGroups(groups.filter((_, i) => i !== gIdx)); setGi(0); setPi(0); }}>
              この区分を消す
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** よくあるオン・オフのスライドスイッチ */
function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={styles.switch} data-on={on || undefined} onClick={() => onChange(!on)} disabled={disabled}>
      <span />
    </button>
  );
}

/** 予約ページの並び順：保存した順に、まだ入っていないもの（新しいメニューなど）を後ろへ */
function fullOrder(order: string[], items: SundayMenu[]): string[] {
  const keys = ["tattoo", "artmake", ...items.map((it) => it.id)];
  return [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
}

const newMenuId = () => `n${Math.random().toString(36).slice(2, 10)}`.slice(0, 12).padEnd(5, "0");

const emptySundayMenu = (): SundayMenu => ({ id: newMenuId(), enabled: true, name: "", firstMinutes: 0, firstLaneIds: [], firstMenuId: "", repeatMinutes: 0, repeatLaneIds: [], repeatMenuId: "", machine: "", note: "" });

/**
 * 日曜メニューの表：院が日曜の受付を許可したメニュー（タトゥー以外）。予約ページで患者が選び、その場で予約が入る。
 * 初診・再診ごとに、受けるか（スイッチ）・時間・レーン（複数ならチェックの順に空いているほう）・予約に付けるメニュー
 */
function SundayMenusEditor({
  items,
  setItems,
  lanes,
  menus,
  canEdit,
  fixed,
  order,
  setOrder,
}: {
  items: SundayMenu[];
  setItems: (next: SundayMenu[]) => void;
  lanes: Lane[];
  menus: Menu[];
  canEdit: boolean;
  fixed: { key: string; title: string; on: boolean; setOn: (on: boolean) => void; about: string; warn: boolean; detail: ReactNode }[];
  order: string[];
  setOrder: (next: string[]) => void;
}) {
  const laneName = (id: string) => lanes.find((l) => l.id === id)?.shortName || lanes.find((l) => l.id === id)?.name || "?";
  const summary = (it: SundayMenu) => {
    const mode = timeMode(it);
    const how =
      mode === "parts" ? "部位ごとの時間" : mode === "count" ? `本数（${it.countPerMinute}本で1分）` : mode === "flow" ? `麻酔つき（施術 クリーム${it.creamMinutes ?? 0}分・注射${it.injectionMinutes ?? 0}分）` : "";
    const parts = (["first", "repeat"] as const).map((k) => {
      const on = mode === "fixed" ? it[`${k}Minutes`] > 0 : it[`${k}LaneIds`].length > 0;
      const lanesText = it[`${k}LaneIds`].map(laneName).join("・") || "レーン未選択";
      if (!on) return `${k === "first" ? "初診" : "再診"} 受けない`;
      return mode === "fixed" || (mode === "flow" && k === "first") ? `${k === "first" ? "初診" : "再診"} ${it[`${k}Minutes`]}分（${lanesText}）` : `${k === "first" ? "初診" : "再診"}${it[`${k}Minutes`] ? ` ＋${it[`${k}Minutes`]}分` : ""}（${lanesText}）`;
    });
    return [how, ...parts].filter(Boolean).join("／");
  };
  const put = (i: number, patch: Partial<SundayMenu>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  // 初診・再診を受けるか：時間で決まるメニューは時間があるか、部位・本数・麻酔の再診はレーンがあるか
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const kindOn = (it: SundayMenu, k: "first" | "repeat") => (isVariable(it) || (it.flow && k === "repeat") ? it[`${k}LaneIds`].length > 0 : it[`${k}Minutes`] > 0);
  const setKind = (i: number, it: SundayMenu, k: "first" | "repeat", on: boolean) => {
    setShown({ ...shown, [`${i}-${k}`]: on });
    if (on) {
      if (!(isVariable(it) || (it.flow && k === "repeat")) && it[`${k}Minutes`] <= 0) put(i, { [`${k}Minutes`]: 15 } as Partial<SundayMenu>);
    } else {
      put(i, (isVariable(it) || (it.flow && k === "repeat") ? { [`${k}LaneIds`]: [], [`${k}MenuId`]: "" } : { [`${k}Minutes`]: 0, [`${k}LaneIds`]: [], [`${k}MenuId`]: "" }) as Partial<SundayMenu>);
    }
  };
  const activeLanes = (ids: string[]) => lanes.filter((l) => l.active || ids.includes(l.id));
  // 選んだレーンのどれかで使えるメニュー（レーンの指定がないメニューも）
  const menusFor = (laneIds: string[], id: string) =>
    menus.filter((m) => (m.active && !m.deleted && ((m.laneIds ?? []).length === 0 || laneIds.some((l) => (m.laneIds ?? []).includes(l)))) || m.id === id);
  const itemDetail = (it: SundayMenu, i: number) => (
    <>
            <label className={styles.field}>
              <span>患者に見せる名前</span>
              <input className={styles.input} value={it.name} maxLength={40} onChange={(ev) => put(i, { name: ev.target.value })} disabled={!canEdit} placeholder="例：ボトックス注射" />
            </label>
            <label className={styles.field}>
              <span>分類（予約ページでまず選ぶ分類）</span>
              <input className={styles.input} value={it.category ?? ""} maxLength={20} list="sunday-cats" onChange={(ev) => put(i, { category: ev.target.value })} disabled={!canEdit} placeholder="例：注射・注入" />
            </label>
            <label className={styles.field}>
              <span>時間の決め方</span>
              <select
                className={styles.input}
                value={timeMode(it)}
                onChange={(ev) => {
                  const mode = ev.target.value as TimeMode;
                  put(i, {
                    partGroups: mode === "parts" ? (it.partGroups?.length ? it.partGroups : [{ name: "部位", parts: [{ name: "新しい部位", minutes: 10 }] }]) : [],
                    countPerMinute: mode === "count" ? it.countPerMinute || 4 : 0,
                    flow: mode === "flow",
                  });
                }}
                disabled={!canEdit}
              >
                <option value="fixed">決まった時間</option>
                <option value="parts">部位ごとの時間（患者が部位を選び、合計の時間）</option>
                <option value="count">本数（患者が本数を入れる）</option>
                <option value="flow">麻酔つきの注入（モニターの有無と麻酔で、麻酔・撮影のレーンと待ち時間を分ける）</option>
              </select>
            </label>
            {timeMode(it) === "flow" && (
              <div style={{ display: "grid", gap: 6 }}>
                <p className={styles.hint} style={{ margin: 0 }}>
                  当院がはじめての方は下の「初診」の時間の医師の診察だけ。受診したことのある方は、今回の治療内容と麻酔を選びます。院内の麻酔クリームは麻酔のレーンで10分→40〜60分後（なるべく45分後）に施術、モニターはネオボ撮影＋頬麻酔15分→クリームなら40〜60分後・それ以外は直後に施術、この治療が初めての方は施術の最初の10分に医師の診察を重ねます。施術は「再診」のレーンとメニューで取ります。
                </p>
                <div className={styles.timeRow}>
                  <label className={styles.field}>
                    <span>施術の時間（麻酔クリーム・自分で塗る・なし）</span>
                    <input className={styles.input} type="number" min={0} max={180} step={5} value={it.creamMinutes ?? 0} onChange={(ev) => put(i, { creamMinutes: Number(ev.target.value) || 0 })} disabled={!canEdit} />
                  </label>
                  <label className={styles.field}>
                    <span>施術の時間（麻酔の注射）</span>
                    <input className={styles.input} type="number" min={0} max={180} step={5} value={it.injectionMinutes ?? 0} onChange={(ev) => put(i, { injectionMinutes: Number(ev.target.value) || 0 })} disabled={!canEdit} />
                  </label>
                </div>
                <div className={styles.field}>
                  <span>麻酔・撮影のレーン</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                    {activeLanes(it.anesLaneIds ?? []).map((l) => (
                      <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={(it.anesLaneIds ?? []).includes(l.id)}
                          onChange={(ev) => put(i, { anesLaneIds: ev.target.checked ? [...(it.anesLaneIds ?? []), l.id] : (it.anesLaneIds ?? []).filter((x) => x !== l.id) })}
                          disabled={!canEdit}
                        />
                        {l.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className={styles.timeRow}>
                  {(
                    [
                      ["creamMenuId", "麻酔クリーム（10分）のメニュー", it.anesLaneIds ?? []],
                      ["neoboMenuId", "ネオボ撮影＋頬麻酔（15分）のメニュー", it.anesLaneIds ?? []],
                      ["doctorMenuId", "医師の診察（この治療が初めての方・10分）のメニュー", [it.doctorLaneId || it.firstLaneIds[0] || ""]],
                    ] as const
                  ).map(([key, label, ls]) => (
                    <label key={key} className={styles.field}>
                      <span>{label}</span>
                      <select className={styles.input} value={it[key] ?? ""} onChange={(ev) => put(i, { [key]: ev.target.value } as Partial<SundayMenu>)} disabled={!canEdit}>
                        <option value="">（選ばない）</option>
                        {menusFor([...ls], it[key] ?? "").map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {timeMode(it) === "parts" && <PartsEditor it={it} onChange={(partGroups) => put(i, { partGroups })} canEdit={canEdit} />}
            {(timeMode(it) === "parts" || timeMode(it) === "count") && (
              <div className={styles.timeRow}>
                {timeMode(it) === "count" && (
                  <label className={styles.field}>
                    <span>1分あたりの本数</span>
                    <input className={styles.input} type="number" min={1} max={100} value={it.countPerMinute ?? 0} onChange={(ev) => put(i, { countPerMinute: Number(ev.target.value) || 0 })} disabled={!canEdit} />
                  </label>
                )}
                <label className={styles.field}>
                  <span>1回の時間の上限（分。0 なら180分。超えるときは予約ページで選べない）</span>
                  <input className={styles.input} type="number" min={0} max={180} step={5} value={it.maxMinutes ?? 0} onChange={(ev) => put(i, { maxMinutes: Number(ev.target.value) || 0 })} disabled={!canEdit} />
                </label>
              </div>
            )}
            {(["first", "repeat"] as const).map((k) => {
              const laneIds = it[`${k}LaneIds`];
              const menuId = it[`${k}MenuId`];
              const variable = isVariable(it);
              return (
                <div key={k} style={{ display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                    <Switch on={kindOn(it, k) || !!shown[`${i}-${k}`]} onChange={(on) => setKind(i, it, k, on)} label={`${it.name} ${k === "first" ? "初診" : "再診"}`} disabled={!canEdit} />
                    {k === "first" ? "初診（はじめての方）" : "再診（2回目以降の方）"}
                  </div>
                  {(kindOn(it, k) || !!shown[`${i}-${k}`]) && !(it.flow && k === "repeat") && (
                  <label className={styles.field}>
                    <span>{it.flow ? "時間（分。医師の診察）" : variable ? "足す時間（分。説明など）" : "時間（分）"}</span>
                    <input
                      className={styles.input}
                      type="number"
                      min={0}
                      max={180}
                      step={5}
                      value={it[`${k}Minutes`]}
                      onChange={(ev) => put(i, { [`${k}Minutes`]: Number(ev.target.value) || 0 } as Partial<SundayMenu>)}
                      disabled={!canEdit}
                    />
                  </label>
                  )}
                  {(kindOn(it, k) || !!shown[`${i}-${k}`]) && (
                    <>
                      <div className={styles.field}>
                        <span>レーン</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                          {activeLanes(laneIds).map((l) => (
                            <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <input
                                type="checkbox"
                                checked={laneIds.includes(l.id)}
                                onChange={(ev) => put(i, { [`${k}LaneIds`]: ev.target.checked ? [...laneIds, l.id] : laneIds.filter((x) => x !== l.id) } as Partial<SundayMenu>)}
                                disabled={!canEdit}
                              />
                              {l.name}
                            </label>
                          ))}
                        </div>
                      </div>
                      <label className={styles.field}>
                        <span>予約に付けるメニュー</span>
                        <select className={styles.input} value={menuId} onChange={(ev) => put(i, { [`${k}MenuId`]: ev.target.value } as Partial<SundayMenu>)} disabled={!canEdit || laneIds.length === 0}>
                          <option value="">（選ばない）</option>
                          {menusFor(laneIds, menuId).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              );
            })}
            <label className={styles.field}>
              <span>機器の名前（任意。同じ名前のもの同士は同じ時刻に入れない）</span>
              <input className={styles.input} value={it.machine} maxLength={30} onChange={(ev) => put(i, { machine: ev.target.value })} disabled={!canEdit} placeholder="例：脱毛レーザー" />
            </label>
            <label className={styles.field}>
              <span>ご来院前のお願い（任意。予約ページと確定の連絡に出ます）</span>
              <input className={styles.input} value={it.note} maxLength={200} onChange={(ev) => put(i, { note: ev.target.value })} disabled={!canEdit} placeholder="例：当日はメイクを落としやすい状態でお越しください。" />
            </label>
            {canEdit && (
              <button type="button" className={styles.linkDanger} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                このメニューを一覧から消す
              </button>
            )}
    </>
  );
  const [sel, setSel] = useState<string>(fixed[0]?.key ?? "");
  const [drag, setDrag] = useState<string | null>(null);
  const unsorted = [
    ...fixed.map((f) => ({ key: f.key, title: f.title, on: f.on, setOn: f.setOn, summary: f.about, warn: f.warn, detail: f.detail })),
    ...items.map((it, i) => ({
      key: it.id,
      title: it.name.trim() || `日曜メニュー ${i + 1}`,
      on: it.enabled,
      setOn: (on: boolean) => put(i, { enabled: on }),
      summary: `${it.category?.trim() ? `［${it.category.trim()}］` : ""}${summary(it)}`,
      warn: it.enabled && !!sundayMenuProblem(it, i),
      detail: itemDetail(it, i),
    })),
  ];
  const seq = fullOrder(order, items);
  const rows = seq.map((k) => unsorted.find((r) => r.key === k)).filter((r): r is (typeof unsorted)[number] => !!r);
  const selRow = rows.find((r) => r.key === sel) ?? rows[0];
  const selKey = selRow?.key;
  // 並べ替え：ドラッグで目的の行の前へ。スマホは「上へ・下へ」
  const moveTo = (key: string, before: string) => {
    if (key === before) return;
    const rest = seq.filter((k) => k !== key);
    const at = rest.indexOf(before);
    setOrder([...rest.slice(0, at), key, ...rest.slice(at)]);
  };
  const moveBy = (key: string, d: -1 | 1) => {
    const at = seq.indexOf(key);
    const to = at + d;
    if (to < 0 || to >= seq.length) return;
    const next = [...seq];
    [next[at], next[to]] = [next[to], next[at]];
    setOrder(next);
  };
  const catList = Array.from(new Set(["除去", "注射・注入", "ピーリング", "脱毛", "レーザー", "内服・ご相談", ...items.map((it) => it.category?.trim() ?? "").filter(Boolean)]));
  return (
    <>
      <datalist id="sunday-cats">
        {catList.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p className={styles.hint}>行をドラッグすると、予約ページに出る順を並べ替えられます。分類は、いちばん上にあるメニューの分類から順に出ます。</p>
      <div className={styles.sundayMaster}>
        <ul className={styles.sundayList} aria-label="日曜メニュー">
          {rows.map((r) => (
            <li
              key={r.key}
              data-sel={r.key === selKey || undefined}
              data-off={!r.on || undefined}
              data-drop={(drag && drag !== r.key) || undefined}
              draggable={canEdit}
              onDragStart={(ev) => { setDrag(r.key); ev.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(ev) => { if (drag) ev.preventDefault(); }}
              onDrop={(ev) => { ev.preventDefault(); if (drag) moveTo(drag, r.key); setDrag(null); }}
              onDragEnd={() => setDrag(null)}
            >
              {canEdit && <span className={styles.sundayGrip} aria-hidden="true">⋮⋮</span>}
              <Switch on={r.on} onChange={r.setOn} label={r.title} disabled={!canEdit} />
              <button type="button" className={styles.sundayRow} onClick={() => setSel(r.key)} aria-current={r.key === selKey || undefined}>
                <strong>{r.title}</strong>
                <span className={styles.sundaySummary}>{r.summary}</span>
              </button>
              {r.warn && <span className={styles.sundayWarn}>要設定</span>}
            </li>
          ))}
          {canEdit && items.length < 40 && (
            <li className={styles.sundayAdd}>
              <button type="button" onClick={() => { const it = emptySundayMenu(); setItems([...items, it]); setSel(it.id); }}>
                ＋ 日曜メニューを足す
              </button>
            </li>
          )}
        </ul>
        <div className={styles.sundayPane}>
          {selRow ? (
            <>
              <div className={styles.sundayPaneHead}>
                <Switch on={selRow.on} onChange={selRow.setOn} label={selRow.title} disabled={!canEdit} />
                <h5>{selRow.title}</h5>
                {canEdit && (
                  <span className={styles.sundayMove}>
                    <button type="button" onClick={() => moveBy(selRow.key, -1)} disabled={seq.indexOf(selRow.key) === 0}>
                      ↑ 上へ
                    </button>
                    <button type="button" onClick={() => moveBy(selRow.key, 1)} disabled={seq.indexOf(selRow.key) === seq.length - 1}>
                      ↓ 下へ
                    </button>
                  </span>
                )}
              </div>
              <div className={styles.sundayDetail}>{selRow.detail}</div>
            </>
          ) : (
            <p className={styles.hint}>左の一覧からメニューを選ぶと、ここに設定が出ます。</p>
          )}
        </div>
      </div>
    </>
  );
}
