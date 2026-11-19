"use client";

import { useState } from "react";
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
  tattoo,
  menus = [],
  canEdit,
  onChanged,
  notify,
  fail,
}: {
  clinic: ClinicSettings;
  lanes: Lane[];
  homepageDays?: HomepageDays;
  onlineCs?: { url: string; mail: boolean };
  tattoo?: { url: string; lineUrl?: string };
  menus?: Menu[];
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
      <TattooCard clinic={clinic} lanes={lanes} menus={menus} info={tattoo} mail={onlineCs?.mail} canEdit={canEdit} onChanged={onChanged} notify={notify} fail={fail} />
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
function TattooCard({
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
  // タトゥーを受けない（照射のレーン・メニューなし）でも、日曜メニューがあれば予約ページは開く
  const missing = enabled && (!laneId || !menuId) && items.length === 0;
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
        sundayMenus: items,
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
      <h3 className={styles.cardTitle}>日曜の Web 予約（タトゥー・アートメイク除去と日曜メニュー）</h3>
      <p className={styles.hint}>
        開ける日時を1行に1つ入れると、患者が予約ページで面積と初診・再診を入れて、その場で予約できます（予約表に入り、確定のメールを送ります）。照射の時間は面積で決まり（〜10cm² 5分、〜30 10分、〜50 15分、〜150 20分、〜300 30分、それ以上は10cm²ごとに1分）、初診は説明10分を足します。選べる時刻は、受付日時の中の空きの最初と、後ろに予約がある空きの最後だけです（空いた日は受付の最初の時刻だけ。予約の間に半端な空きが残らないように）。LIFF ID を入れると、LINE の中で開いた方は本人の LINE が予約と患者に結びつき、確定の連絡が LINE に届きます。閉じるときは行を消して保存します。
      </p>
      <label className={styles.field} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <input type="checkbox" style={{ marginTop: 3, flexShrink: 0 }} checked={enabled} onChange={(ev) => setEnabled(ev.target.checked)} disabled={!canEdit} />
        <span>予約ページで受け付ける</span>
      </label>
      <label className={styles.field}>
        <span>照射のレーン</span>
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
      <SundayMenusEditor items={items} setItems={setItems} lanes={lanes} menus={menus} canEdit={canEdit} />
      <label className={styles.field}>
        <span>受付日時（タトゥーと日曜メニューで共通。1行に1つ、例：2026-12-06 10:00-13:00）</span>
        <textarea className={styles.input} value={text} rows={4} onChange={(ev) => setText(ev.target.value)} disabled={!canEdit} />
      </label>
      <label className={styles.field}>
        <span>LINE で開くための LIFF ID（LINE Developers で、エンドポイントを予約ページにした LIFF アプリの ID。空なら LINE を使わずメールで確定）</span>
        <input className={styles.input} value={liffId} maxLength={80} onChange={(ev) => setLiffId(ev.target.value)} disabled={!canEdit} placeholder="例：1234567890-AbCdEfGh" />
      </label>
      {info?.lineUrl && <p className={styles.hint}>LINE で開くアドレス：{info.lineUrl}（ホームページのボタン・LINE のメニューに貼る）</p>}
      <p className={styles.hint} data-invalid={bad || badLiff || badItem || missing || (enabled && mail === false) || undefined}>
        {badItem
          ? badItem
          : badLiff
          ? "LIFF ID の形が正しくありません（例：1234567890-AbCdEfGh）"
          : bad
          ? `受付日時の形が正しくありません：${bad}`
          : missing
            ? "受け付けるには、照射のレーンとメニューを選ぶか、日曜メニューを足してください。"
            : enabled && mail === false
              ? "メールの送信元が未設定のため、確定のメールを送れません（設定 → リマインド）。"
              : info?.url
                ? `予約ページ：${info.url}（院の LINE のメニューなどから開けるようにします）`
                : "予約ページは、問診票のアドレスと同じサイトの /tattoo/ です。"}
      </p>
      {canEdit && (
        <div className={styles.actions}>
          <button className={styles.primary} onClick={save} disabled={!!bad || badLiff || !!badItem || busy}>
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
  for (const [k, ja] of [["first", "初診"], ["repeat", "再診"]] as const) {
    const min = it[`${k}Minutes`];
    if (!Number.isInteger(min) || min < 0 || min > 180 || min % 5 !== 0) return `「${label}」の${ja}の時間は0〜180分（5分刻み）で入れてください`;
    if (min > 0 && (it[`${k}LaneIds`].length === 0 || !it[`${k}MenuId`])) return `「${label}」の${ja}は、レーンと予約に付けるメニューを選んでください（受けないときは時間を0に）`;
  }
  if (it.firstMinutes === 0 && it.repeatMinutes === 0) return `「${label}」は、初診か再診の時間を入れてください`;
  return "";
}

const emptySundayMenu = (): SundayMenu => ({ id: "", name: "", firstMinutes: 0, firstLaneIds: [], firstMenuId: "", repeatMinutes: 0, repeatLaneIds: [], repeatMenuId: "", machine: "", note: "" });

/**
 * 日曜メニューの表：院が日曜の受付を許可したメニュー（タトゥー以外）。予約ページで患者が選び、その場で予約が入る。
 * 初診・再診ごとに、時間（0 なら受けない）・レーン（複数ならチェックの順に空いているほう）・予約に付けるメニュー
 */
function SundayMenusEditor({
  items,
  setItems,
  lanes,
  menus,
  canEdit,
}: {
  items: SundayMenu[];
  setItems: (next: SundayMenu[]) => void;
  lanes: Lane[];
  menus: Menu[];
  canEdit: boolean;
}) {
  const put = (i: number, patch: Partial<SundayMenu>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const activeLanes = (ids: string[]) => lanes.filter((l) => l.active || ids.includes(l.id));
  // 選んだレーンのどれかで使えるメニュー（レーンの指定がないメニューも）
  const menusFor = (laneIds: string[], id: string) =>
    menus.filter((m) => (m.active && !m.deleted && ((m.laneIds ?? []).length === 0 || laneIds.some((l) => (m.laneIds ?? []).includes(l)))) || m.id === id);
  return (
    <>
      <h4 className={styles.subTitle}>日曜メニュー（タトゥー以外に、日曜に患者が自分で予約できるメニュー）</h4>
      <p className={styles.hint}>
        ここに足したメニューだけが、日曜の予約ページに出ます。初診・再診それぞれの時間を入れ、受けない区分は0にします（予約枠時間一覧の時間に合わせてください。初診は医師の診察の時間）。レーンを2つ以上選ぶと、空いているほうに入ります。選べる時刻の決め方はタトゥーと同じです。機器の名前が同じもの同士は、レーンが違っても同じ時刻に入りません（予約に付けるメニューで見分けるので、「予約（メモに自由記載）」など共通のメニューに機器の名前は付けないでください）。
      </p>
      {items.length === 0 && <p className={styles.hint}>まだありません（タトゥー・アートメイク除去だけを受け付けます）。</p>}
      {items.map((it, i) => (
        <fieldset key={it.id || `new-${i}`} className={styles.field} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", display: "grid", gap: 6 }}>
          <legend style={{ fontWeight: 700 }}>{it.name.trim() || `日曜メニュー ${i + 1}`}</legend>
          <label className={styles.field}>
            <span>患者に見せる名前</span>
            <input className={styles.input} value={it.name} maxLength={40} onChange={(ev) => put(i, { name: ev.target.value })} disabled={!canEdit} placeholder="例：ボトックス注射" />
          </label>
          {(["first", "repeat"] as const).map((k) => {
            const laneIds = it[`${k}LaneIds`];
            const menuId = it[`${k}MenuId`];
            return (
              <div key={k} style={{ display: "grid", gap: 4 }}>
                <label className={styles.field}>
                  <span>{k === "first" ? "初診（はじめての方）" : "再診（2回目以降の方）"}の時間（分。0 なら受けない）</span>
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
                {it[`${k}Minutes`] > 0 && (
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
              このメニューを日曜の予約ページから外す
            </button>
          )}
        </fieldset>
      ))}
      {canEdit && items.length < 30 && (
        <div className={styles.actions}>
          <button type="button" onClick={() => setItems([...items, emptySundayMenu()])}>
            日曜メニューを足す
          </button>
        </div>
      )}
    </>
  );
}
