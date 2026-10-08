"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lane, Menu } from "@/lib/domain/types";
import { searchKey } from "@/lib/domain/text";
import { ApiError, deleteLane, deleteMenu, fetchMe, fetchSettings, reorder, saveLane, type SettingsData } from "@/components/calendar/api";
import type { StaffPublic } from "@/lib/domain/types";
import { AuditTab, StaffTab } from "./StaffTab";
import { ClinicTab, ThemeCard } from "./ClinicTab";
import { DisplayPrefsCard } from "./DisplayPrefsCard";
import { DevicesTab } from "./DevicesTab";
import { PricesTab } from "./PricesTab";
import { ConsentsTab } from "./ConsentsTab";
import { QuestionnairesTab } from "./QuestionnairesTab";
import { ImportsTab } from "./ImportsTab";
import { M3MatchCard } from "./M3MatchCard";
import { ProductsTab } from "./ProductsTab";
import { StagesTab } from "./StagesTab";
import { RestoreTab } from "./RestoreTab";
import { durationLabel, priceLabel } from "@/components/calendar/menuFormat";
import { MenuEditor } from "./MenuEditor";
import styles from "./settings.module.css";

const TABS = ["lanes", "menus", "stages", "products", "prices", "consents", "questionnaires", "imports", "devices", "clinic", "appearance", "staff", "audit", "restore"] as const;
type Tab = (typeof TABS)[number];

const MIN_LANES = 1;
const MAX_LANES = 30;

export function SettingsApp() {
  const [tab, setTab] = useState<Tab>("lanes");
  const [data, setData] = useState<SettingsData | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [me, setMe] = useState<StaffPublic | null>(null);

  useEffect(() => {
    fetchMe().then(setMe, () => {});
    // 「?tab=menus」などで開いたときはそのタブから
    const t = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t && TABS.includes(t as Tab)) setTab(t as Tab);
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await fetchSettings());
    } catch {
      setMessage({ text: "設定を読み込めませんでした", kind: "error" });
    }
  }, []);

  useEffect(() => {
    // 初回の読み込み
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const notify = useCallback((text: string, kind: "info" | "error" = "info") => {
    setMessage({ text, kind });
    window.setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 4000);
  }, []);
  const fail = useCallback(
    (err: unknown) => notify(err instanceof ApiError ? err.message : "保存できませんでした", "error"),
    [notify],
  );
  const isAdmin = me?.role === "admin";
  const canEdit = !!me?.canManage;

  return (
    <div className={styles.page} data-ui-zoom>
      <header className={styles.head}>
        <Link href="/" className={styles.back}>
          ← カレンダーへ
        </Link>
        <h1>設定</h1>
        <nav className={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === "lanes"} onClick={() => setTab("lanes")}>
            レーン
          </button>
          <button role="tab" aria-selected={tab === "menus"} onClick={() => setTab("menus")}>
            メニュー
          </button>
          <button role="tab" aria-selected={tab === "stages"} onClick={() => setTab("stages")}>
            状態
          </button>
          <button role="tab" aria-selected={tab === "products"} onClick={() => setTab("products")}>
            スキンケア・内服
          </button>
          <button role="tab" aria-selected={tab === "prices"} onClick={() => setTab("prices")}>
            料金表
          </button>
          <button role="tab" aria-selected={tab === "consents"} onClick={() => setTab("consents")}>
            同意書
          </button>
          <button role="tab" aria-selected={tab === "questionnaires"} onClick={() => setTab("questionnaires")}>
            問診票
          </button>
          <button role="tab" aria-selected={tab === "imports"} onClick={() => setTab("imports")}>
            取り込み
          </button>
          <button role="tab" aria-selected={tab === "devices"} onClick={() => setTab("devices")}>
            外部機器の連携
          </button>
          <button role="tab" aria-selected={tab === "clinic"} onClick={() => setTab("clinic")}>
            院の情報・診療時間
          </button>
          <button role="tab" aria-selected={tab === "appearance"} onClick={() => setTab("appearance")}>
            画面の表示・配色
          </button>
          {isAdmin && (
            <>
              <button role="tab" aria-selected={tab === "staff"} onClick={() => setTab("staff")}>
                スタッフ
              </button>
              <button role="tab" aria-selected={tab === "audit"} onClick={() => setTab("audit")}>
                操作ログ
              </button>
              <button role="tab" aria-selected={tab === "restore"} onClick={() => setTab("restore")}>
                設定の復元
              </button>
            </>
          )}
        </nav>
      </header>

      {message && (
        <div className={styles.message} data-kind={message.kind} role="status">
          {message.text}
        </div>
      )}

      {me && !canEdit && (tab === "lanes" || tab === "menus" || tab === "stages" || tab === "products" || tab === "clinic") && (
        <p className={styles.lead}>このログインでは見るだけです。変更・削除は、院長・管理者と受付、または院長が「設定 → スタッフ」で許可したスタッフができます。</p>
      )}
      {tab === "staff" && isAdmin ? (
        <StaffTab notify={notify} fail={fail} />
      ) : tab === "audit" && isAdmin ? (
        <AuditTab fail={fail} />
      ) : tab === "restore" && isAdmin ? (
        <RestoreTab onChanged={load} notify={notify} fail={fail} />
      ) : tab === "devices" ? (
        <DevicesTab isAdmin={isAdmin} canEdit={canEdit} notify={notify} fail={fail} />
      ) : tab === "prices" ? (
        <PricesTab canEdit={canEdit} isAdmin={isAdmin} notify={notify} fail={fail} />
      ) : !data ? (
        <p className={styles.muted}>読み込み中…</p>
      ) : tab === "imports" ? (
        <>
          <ImportsTab menus={data.menus} lanes={data.lanes} canEdit={canEdit} onChanged={load} notify={notify} fail={fail} />
          {isAdmin && <M3MatchCard notify={notify} fail={fail} />}
        </>
      ) : tab === "questionnaires" ? (
        <QuestionnairesTab canEdit={canEdit} isAdmin={isAdmin} notify={notify} fail={fail} />
      ) : tab === "consents" ? (
        <ConsentsTab menus={data.menus} canEdit={canEdit} isAdmin={isAdmin} notify={notify} fail={fail} />
      ) : tab === "stages" ? (
        <StagesTab stages={data.stages} canEdit={canEdit} onChanged={load} notify={notify} fail={fail} />
      ) : tab === "products" ? (
        <ProductsTab products={data.products} canEdit={canEdit} onChanged={load} notify={notify} fail={fail} />
      ) : tab === "clinic" ? (
        <ClinicTab key={JSON.stringify(data.clinic)} clinic={data.clinic} canEdit={canEdit} onChanged={load} notify={notify} fail={fail} />
      ) : tab === "appearance" ? (
        <section className={styles.clinic}>
          <p className={styles.lead}>画面の見た目の設定です。配色は院で1つ（すべての端末に反映）、その下の表示はこの端末ごとに選べます。</p>
          <ThemeCard key={data.clinic.theme ?? "default"} clinic={data.clinic} canEdit={canEdit} onChanged={load} notify={notify} fail={fail} />
          <DisplayPrefsCard />
        </section>
      ) : tab === "lanes" ? (
        <LanesTab lanes={data.lanes} onChanged={load} notify={notify} fail={fail} />
      ) : (
        <MenusTab data={data} onChanged={load} notify={notify} fail={fail} />
      )}
    </div>
  );
}

// ---- レーン ----

interface TabProps {
  onChanged: () => Promise<void>;
  notify: (text: string) => void;
  fail: (err: unknown) => void;
}

function move<T extends { id: string }>(items: T[], index: number, delta: number): string[] {
  const ids = items.map((x) => x.id);
  const j = index + delta;
  if (j < 0 || j >= ids.length) return ids;
  [ids[index], ids[j]] = [ids[j], ids[index]];
  return ids;
}

function LanesTab({ lanes, onChanged, notify, fail }: TabProps & { lanes: Lane[] }) {
  const [newName, setNewName] = useState("");
  const [newShort, setNewShort] = useState("");
  const activeCount = lanes.filter((l) => l.active).length;
  const full = activeCount >= MAX_LANES;

  const doReorder = async (i: number, d: number) => {
    try {
      await reorder("lanes", move(lanes, i, d));
      await onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const add = async () => {
    try {
      await saveLane(null, { name: newName, shortName: newShort });
      setNewName("");
      setNewShort("");
      await onChanged();
      notify("レーンを追加しました");
    } catch (err) {
      fail(err);
    }
  };

  return (
    <section>
      <p className={styles.lead}>
        予約カレンダーの列です。表示できるレーンは{MIN_LANES}〜{MAX_LANES}本で、名前の変更・並べ替え・追加ができます（一番上が左端）。
        使わなくなったレーンは「表示」を外すとカレンダーから消えます（過去の予約は残ります）。予約の記録が一度もないレーンは削除できます。
        今日以降の予約が残っているレーンは、予約を移してから外してください。
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.orderCol}>順番</th>
            <th>レーン名</th>
            <th>短い名前（スマホ用）</th>
            <th>表示</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {lanes.map((l, i) => (
            <LaneRow
              key={`${l.id}:${l.name}:${l.shortName}:${l.active}`}
              lane={l}
              first={i === 0}
              last={i === lanes.length - 1}
              onUp={() => doReorder(i, -1)}
              onDown={() => doReorder(i, 1)}
              onDelete={async () => {
                if (!window.confirm(`「${l.name}」を削除しますか？`)) return;
                try {
                  await deleteLane(l.id);
                  await onChanged();
                  notify("レーンを削除しました");
                } catch (err) {
                  fail(err);
                }
              }}
              onSave={async (body) => {
                try {
                  await saveLane(l.id, body);
                  await onChanged();
                  notify("保存しました");
                } catch (err) {
                  fail(err);
                  await onChanged();
                }
              }}
            />
          ))}
          <tr className={styles.addRow}>
            <td />
            <td>
              <input
                className={styles.input}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例：5番レーン（ダーマペン）"
                maxLength={40}
                aria-label="新しいレーン名"
              />
            </td>
            <td>
              <input
                className={styles.input}
                value={newShort}
                onChange={(e) => setNewShort(e.target.value)}
                placeholder="例：5番"
                maxLength={12}
                aria-label="新しいレーンの短い名前"
              />
            </td>
            <td />
            <td>
              <button className={styles.primary} onClick={add} disabled={!newName.trim() || full}>
                追加
              </button>
            </td>
            <td className={styles.muted}>
              表示中 {activeCount} / {MAX_LANES}
              {full && <div>上限です</div>}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function LaneRow(props: {
  lane: Lane;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onSave: (body: Partial<Pick<Lane, "name" | "shortName" | "active">>) => void;
  onDelete: () => void;
}) {
  const { lane } = props;
  const [name, setName] = useState(lane.name);
  const [shortName, setShortName] = useState(lane.shortName);
  const dirty = name !== lane.name || shortName !== lane.shortName;
  return (
    <tr data-inactive={!lane.active || undefined}>
      <td className={styles.orderCol}>
        <button className={styles.arrow} onClick={props.onUp} disabled={props.first} aria-label="上へ">
          ▲
        </button>
        <button className={styles.arrow} onClick={props.onDown} disabled={props.last} aria-label="下へ">
          ▼
        </button>
      </td>
      <td>
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="レーン名" />
      </td>
      <td>
        <input
          className={styles.input}
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          maxLength={12}
          aria-label="短い名前"
        />
      </td>
      <td>
        <label className={styles.toggle}>
          <input type="checkbox" checked={lane.active} onChange={(e) => props.onSave({ active: e.target.checked })} />
          {lane.active ? "表示" : "非表示"}
        </label>
      </td>
      <td>
        <button className={styles.btn} disabled={!dirty} onClick={() => props.onSave({ name, shortName })}>
          保存
        </button>
      </td>
      <td>
        <button className={styles.btn} onClick={props.onDelete} title="予約の記録が一度もないレーンだけ削除できます">
          削除
        </button>
      </td>
    </tr>
  );
}

// ---- メニュー ----

function MenusTab({ data, onChanged, notify, fail }: TabProps & { data: SettingsData }) {
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState<Menu | "new" | null>(null);
  const laneName = useMemo(() => new Map(data.lanes.map((l) => [l.id, l.shortName])), [data.lanes]);

  const q = searchKey(query);
  /** 削除したメニューは出さない（過去の予約の表示のために記録だけ残っている） */
  const live = data.menus.filter((m) => !m.deleted);
  const filtered = live.filter((m) => (showInactive || m.active) && (!q || searchKey(`${m.name}${m.abbr}`).includes(q)));

  const doReorder = async (id: string, d: number) => {
    const i = live.findIndex((m) => m.id === id);
    try {
      await reorder("menus", [...move(live, i, d), ...data.menus.filter((m) => m.deleted).map((m) => m.id)]);
      await onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const doDelete = async (m: Menu) => {
    if (!window.confirm(`「${m.name}」を削除しますか？\n予約登録の選択肢から消えます（これまでの予約の表示はそのまま残ります）`)) return false;
    try {
      await deleteMenu(m.id);
      await onChanged();
      notify("メニューを削除しました");
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  return (
    <section>
      <p className={styles.lead}>
        予約登録で選ぶメニューです。「＋ 新しいメニュー」で追加、行を押して変更、「削除」で消せます（削除しても、これまでの予約の表示はそのまま残ります）。略称は予約表の短い枠に、色は枠の色に使います。
      </p>
      <div className={styles.toolbar}>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メニューを絞り込む"
          aria-label="メニューを絞り込む"
        />
        <label className={styles.toggle}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          使わないメニューも表示
        </label>
        <button className={styles.primary} onClick={() => setEditing("new")}>
          ＋ 新しいメニュー
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.orderCol}>順番</th>
              <th>メニュー名</th>
              <th>略称</th>
              <th>提供時間</th>
              <th>料金（税込）</th>
              <th>レーン</th>
              <th>予約の選択肢</th>
              <th aria-label="削除" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} data-inactive={!m.active || undefined} className={styles.clickRow} onClick={() => setEditing(m)}>
                <td className={styles.orderCol} onClick={(e) => e.stopPropagation()}>
                  <button
                    className={styles.arrow}
                    onClick={() => doReorder(m.id, -1)}
                    disabled={!!q || live[0]?.id === m.id}
                    aria-label="上へ"
                  >
                    ▲
                  </button>
                  <button
                    className={styles.arrow}
                    onClick={() => doReorder(m.id, 1)}
                    disabled={!!q || live[live.length - 1]?.id === m.id}
                    aria-label="下へ"
                  >
                    ▼
                  </button>
                </td>
                <td>
                  <span className={styles.swatch} style={{ background: m.color }} />
                  <button className={styles.nameBtn}>{m.name}</button>
                </td>
                <td>{m.abbr}</td>
                <td>
                  {durationLabel(m.duration)}
                  {m.duration.kind === "range" && <small className={styles.muted}>（{m.duration.step}分刻み）</small>}
                </td>
                <td>{priceLabel(m.priceYen)}</td>
                <td className={styles.lanesCell}>
                  {m.laneIds.length === 0 ? "すべて" : m.laneIds.map((id) => laneName.get(id) ?? "?").join("・")}
                </td>
                <td>{m.active ? "出す" : "出さない"}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className={styles.btn} onClick={() => doDelete(m)} aria-label={`${m.name}を削除`}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <MenuEditor
          menu={editing === "new" ? null : editing}
          lanes={data.lanes}
          onClose={() => setEditing(null)}
          onDelete={
            editing === "new"
              ? undefined
              : async () => {
                  if (await doDelete(editing)) setEditing(null);
                }
          }
          onSaved={async () => {
            setEditing(null);
            await onChanged();
            notify("メニューを保存しました");
          }}
          fail={fail}
        />
      )}
    </section>
  );
}
