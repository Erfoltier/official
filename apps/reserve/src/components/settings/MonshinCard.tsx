"use client";

import { useEffect, useState } from "react";
import { fetchMonshinForm, fetchMonshinHeadings, questionnaireCsvUrl, saveMonshinForm, type MonshinForm, type MonshinQuestion, type MonshinType } from "@/components/calendar/api";
import { withBase } from "@/lib/paths";
import { LineLinkCard } from "./LineLinkCard";
import styles from "./settings.module.css";

const TYPES: { v: MonshinType; label: string }[] = [
  { v: "text", label: "1行の文字" },
  { v: "textarea", label: "複数行の文字" },
  { v: "date", label: "日付" },
  { v: "tel", label: "電話番号" },
  { v: "email", label: "メールアドレス" },
  { v: "choice", label: "1つ選ぶ" },
  { v: "multi", label: "いくつでも選ぶ" },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 設定 → 問診票：患者が入力する問診票の質問と、回答の CSV 書き出し（院長・管理者） */
export function MonshinCard({ notify, fail }: { notify: (t: string) => void; fail: (e: unknown) => void }) {
  const [form, setForm] = useState<MonshinForm | null>(null);
  const [defaults, setDefaults] = useState<MonshinForm | null>(null);
  const [saving, setSaving] = useState(false);
  // 患者向けのページを別のアドレス（monshin.… など）に置くときは config.php の monshin_url
  const [url, setUrl] = useState("");
  const [from, setFrom] = useState(() => ymd(new Date(Date.now() - 30 * 86400_000)));
  const [to, setTo] = useState(() => ymd(new Date()));

  useEffect(() => {
    fetchMonshinForm()
      .then((r) => {
        if (!r.enabled) return;
        setUrl(r.url);
        setForm(r.form);
        setDefaults(r.defaults);
      })
      .catch(fail);
  }, [fail]);

  if (!form) return null;
  const pageUrl = url || (typeof window === "undefined" ? "" : window.location.origin + withBase("/monshin/"));
  const setQ = (i: number, patch: Partial<MonshinQuestion>) => setForm({ ...form, questions: form.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const move = (i: number, d: number) => {
    const qs = [...form.questions];
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    setForm({ ...form, questions: qs });
  };

  const save = async () => {
    setSaving(true);
    try {
      setForm(await saveMonshinForm(form));
      notify("問診票の質問を保存しました");
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  /** これまでの問診票の見出しから質問を作る（回答の中身は使わない。選択肢は院で入れる） */
  const fromPast = async () => {
    try {
      const { items } = await fetchMonshinHeadings();
      if (items.length === 0) {
        notify("取り込んだ問診票がまだありません");
        return;
      }
      if (!window.confirm(`これまでの問診票の質問（${items.length}個）で、いまの質問を置き換えます。保存するまでは反映されません。よろしいですか？`)) return;
      const keep = new Map(form.questions.map((q) => [q.label, q]));
      setForm({
        ...form,
        questions: items.map((h) => keep.get(h.label) ?? { label: h.label, type: h.type, required: /お名前|氏名/.test(h.label) && !/フリガナ|カナ/.test(h.label), options: [] }),
      });
      notify("質問を並べ直しました。「1つ選ぶ」などの選択肢と必須を確かめてから保存してください");
    } catch (err) {
      fail(err);
    }
  };

  const exportCsv = () => {
    if (!from || !to || from > to) {
      fail(new Error("期間を正しく選んでください"));
      return;
    }
    window.location.href = questionnaireCsvUrl(from, to);
  };

  return (
    <>
      <h3 className={styles.subhead}>患者が入力する問診票</h3>
      <p className={styles.muted}>
        患者はログインなしで入力・送信できます（回答を見ることはできません）。送信された回答は Google フォームの回答と同じように取り込まれ、患者に紐付きます。
        {pageUrl && (
          <>
            <br />
            患者向けのページ：<code>{pageUrl}</code>
          </>
        )}
      </p>
      <label className={styles.muted}>ページの見出し</label>
      <input className={styles.input} value={form.title} maxLength={60} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="ページの見出し" />
      <label className={styles.muted}>はじめの説明</label>
      <textarea className={styles.input} rows={2} value={form.intro} maxLength={1000} onChange={(e) => setForm({ ...form, intro: e.target.value })} aria-label="はじめの説明" style={{ fontFamily: "inherit" }} />
      <label className={styles.muted}>送信後に表示する文</label>
      <textarea className={styles.input} rows={2} value={form.done} maxLength={500} onChange={(e) => setForm({ ...form, done: e.target.value })} aria-label="送信後に表示する文" style={{ fontFamily: "inherit" }} />

      <table className={styles.table}>
        <thead>
          <tr>
            <th>質問</th>
            <th>答え方</th>
            <th>必須</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {form.questions.map((q, i) => (
            <tr key={q.id ?? `new-${i}`}>
              <td>
                <input className={styles.input} value={q.label} maxLength={200} onChange={(e) => setQ(i, { label: e.target.value })} aria-label={`質問${i + 1}`} />
                {(q.type === "choice" || q.type === "multi") && (
                  <input
                    className={styles.input}
                    value={q.options.join("、")}
                    onChange={(e) => setQ(i, { options: e.target.value.split(/[、,，\n]/) })}
                    onBlur={() => setQ(i, { options: q.options.map((o) => o.trim()).filter(Boolean) })}
                    placeholder="選択肢を「、」で区切って入力（例：女性、男性、回答しない）"
                    aria-label={`質問${i + 1}の選択肢`}
                  />
                )}
              </td>
              <td>
                <select className={styles.input} value={q.type} onChange={(e) => setQ(i, { type: e.target.value as MonshinType })} aria-label={`質問${i + 1}の答え方`}>
                  {TYPES.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} aria-label={`質問${i + 1}を必須にする`} />
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className={styles.btn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">
                  ↑
                </button>
                <button className={styles.btn} onClick={() => move(i, 1)} disabled={i === form.questions.length - 1} aria-label="下へ">
                  ↓
                </button>
                <button className={styles.btn} onClick={() => setForm({ ...form, questions: form.questions.filter((_, j) => j !== i) })}>
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.muted}>
        「お名前」「フリガナ」「生年月日」「電話」「既往歴」「内服」「アレルギー」などの言葉を含む質問は、患者への紐付けと基本情報への反映に使います（Google フォームと同じ見分け方）。「お名前」は必須です。
      </p>
      <div className={styles.actions}>
        <button className={styles.btn} onClick={() => setForm({ ...form, questions: [...form.questions, { label: "", type: "text", required: false, options: [] }] })}>
          ＋ 質問を追加
        </button>
        <button className={styles.btn} onClick={fromPast}>
          これまでの問診票の質問から作る
        </button>
        {defaults && (
          <button className={styles.btn} onClick={() => window.confirm("最初の質問の並びに戻します。保存するまでは反映されません。よろしいですか？") && setForm({ ...form, questions: defaults.questions })}>
            最初の並びに戻す
          </button>
        )}
        <button className={styles.primary} disabled={saving} onClick={save}>
          {saving ? "保存中…" : "質問を保存"}
        </button>
      </div>

      {pageUrl && <LineLinkCard pageUrl={pageUrl} notify={notify} fail={fail} />}

      <h3 className={styles.subhead}>問診票の回答を CSV で書き出す</h3>
      <p className={styles.muted}>送信日が期間内の回答を書き出します。書き出した操作は操作の記録に残ります。ファイルはこの端末にだけ保存され、サーバーには残りません。</p>
      <div className={styles.actions}>
        <input type="date" className={styles.input} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="期間のはじめ" style={{ maxWidth: "11em" }} />
        〜
        <input type="date" className={styles.input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="期間のおわり" style={{ maxWidth: "11em" }} />
        <button className={styles.btn} onClick={exportCsv}>
          CSV を書き出す
        </button>
      </div>
    </>
  );
}
