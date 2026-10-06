"""Airリザーブ → 予約カレンダー（ishidahihuka.jp/reserve）の差分の同期（手動で実行）

  python3 apps/reserve/ops/airsync/airsync.py          試し運転：何が変わるかの件数だけ出す（書き込まない）
  python3 apps/reserve/ops/airsync/airsync.py --apply  実際に書き込む

・向きは Air → 予約カレンダーの一方向。今日以降の予約だけを見る（過去は移行で済み）
・Airで新しく入った確定予約 → 書き込む（患者は M3番号＋フリガナ／名前の一致で結びつけ、なければ新しく登録）
・Airでキャンセル → 予約カレンダーでもキャンセル（まだ「予約」の状態のものだけ）
・Airで日時・担当（レーン）・メニュー・メモが変わった → 同じに直す（まだ「予約」の状態のものだけ。来院・完了などは触らない）
・「〇〇看護師出勤」などスタッフの枠 → 予約にせず、その日のそのレーンの Todaysメモに書き足す
・ID・パスワードは環境変数からだけ読む：AIR_ID / AIR_PASSWORD / RESERVE_BASIC_USER / RESERVE_BASIC_PASS / RESERVE_MIGRATION_PIN
・画面に出すのは件数だけ（患者の名前・メモなどは出さない）。エラーでも URL や中身は出さない
"""
import datetime as D
import html
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter

import requests

sys.tracebacklimit = 0
APPLY = "--apply" in sys.argv
JST = D.timezone(D.timedelta(hours=9))

# ---- Airリザーブ（読むだけ） ----
air = requests.Session()
air.headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36"
AIR_SEARCH = "https://airreserve.net/stateful/booking/staff/search/list"
ALL_STATUS = ["KeyCONFIRMED", "KeyUNCONFIRMED", "KeyCANCELED", "KeyWAITLIST"]


def air_login():
    form = air.get("https://airreserve.net/reserve/", timeout=60).text
    m = re.search(r'<form id="command"[^>]*action="([^"]+)"', form)
    if m:
        data = {k: html.unescape(v) for k, v in re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', form)}
        data.update({"username": os.environ["AIR_ID"], "password": os.environ["AIR_PASSWORD"]})
        air.post("https://connect.airregi.jp" + html.unescape(m.group(1)), data=data, timeout=60)
    page = air.get("https://airreserve.net/reserve/booking/list/", timeout=60)
    if "notification" in page.url:
        raise SystemExit("Airリザーブに「お知らせ」が出ています。院長がブラウザでログインして閉じてから、もう一度実行してください")
    tok = re.search(r'id="api-token"[^>]*value="([^"]*)"', page.text)
    hid = {}
    for tag in re.findall(r"<input[^>]*>", page.text):
        n = re.search(r'name="(apiAuthDto\.[a-z]+|_csrf)"', tag)
        v = re.search(r'value="([^"]*)"', tag)
        if n and v:
            hid[n.group(1)] = v.group(1)
    if not hid.get("apiAuthDto.sid"):
        raise SystemExit("Airリザーブにログインできませんでした（AIR_ID / AIR_PASSWORD を確かめてください）")
    return (tok.group(1) if tok else hid.get("_csrf")), hid


def air_fetch(start, end):
    token, hid = air_login()

    def call(a, b, page):
        form = {"bookingFromDt": a + "000000", "bookingToDt": b + "235959", "bookingStatusCdList": ALL_STATUS,
                "apiAuthDto": {"sid": hid.get("apiAuthDto.sid"), "token": hid.get("apiAuthDto.token")}, "page": {"pageNumber": page}}
        t = air.post(AIR_SEARCH, data=json.dumps(form), timeout=60,
                     headers={"Content-Type": "application/json; charset=UTF-8", "X-CSRF-TOKEN": token, "X-Requested-With": "XMLHttpRequest"}).text
        return json.loads(t[t.find("{"):t.rfind("}") + 1])

    def run(a, b):
        f = lambda d: d.strftime("%Y%m%d")
        j = call(f(a), f(b), 0)  # ページは 0 から数える
        code = j["responseCode"]["code"]
        msgs = " ".join(m.get("message") or "" for m in (j.get("messages") or []))
        if code == "BUSINESS_LOGIC_ERROR" and "該当する予約がありません" in msgs:
            return []
        if code == "BUSINESS_LOGIC_ERROR" and (b - a).days > 0:  # 1000件を超えたら期間を半分に
            m = a + (b - a) // 2
            return run(a, m) + run(m + D.timedelta(1), b)
        if code != "SUCCESS":
            return []  # 予約を受け付けていない先の期間など
        out = j["dto"] or []
        for p in range(1, j["page"]["pageCount"]):
            time.sleep(0.3)
            out += call(f(a), f(b), p)["dto"] or []
        return out

    rows, d = [], start
    while d <= end:
        e = min(D.date(d.year + (d.month == 12), d.month % 12 + 1, 1) - D.timedelta(1), end)
        rows += run(d, e)
        d = e + D.timedelta(1)
        time.sleep(0.2)
    return rows


# ---- 予約カレンダー ----
B = "https://ishidahihuka.jp/reserve/api/v1/"
rs = requests.Session()
rs.auth = (os.environ["RESERVE_BASIC_USER"], os.environ["RESERVE_BASIC_PASS"])
rs.headers.update({"Origin": "https://ishidahihuka.jp", "Referer": "https://ishidahihuka.jp/reserve/", "X-Requested-With": "XMLHttpRequest"})


class ApiError(Exception):
    pass


def req(method, path, **kw):
    for i in range(5):
        try:
            r = rs.request(method, B + path, timeout=60, **kw)
        except Exception as e:
            if i == 4:
                raise ApiError(f"{method} {path.split('/')[0]} 通信エラー {type(e).__name__}") from None
            time.sleep(2 ** i)
            continue
        if r.status_code >= 500 and i < 4:
            time.sleep(2 ** i)
            continue
        return r


def call(method, path, **kw):
    r = req(method, path, **kw)
    if r.status_code >= 300:
        try:
            err = r.json().get("error")
        except Exception:
            err = "?"
        raise ApiError(f"{method} {path.split('/')[0]} {r.status_code} {err}")
    return r.json() if r.content else {}


def login():
    staff = call("GET", "auth/staff")["items"]
    me = [x for x in staff if "移行" in x["name"]]
    if len(me) != 1:
        raise SystemExit("移行用スタッフが見つかりません")
    call("POST", "auth/login", json={"staffId": me[0]["id"], "pin": os.environ["RESERVE_MIGRATION_PIN"]})


# ---- 照らし合わせ ----
# Airのリソース（名前が変わっても同じID） → レーン
LANE_ID = {"i00009C274": "lane-main", "i00009C275": "lane-1", "i0000BA016": "lane-3", "i0000C2F11": "lane-4"}
FREE_MENU = "menu-s000099DC1"  # 予約（メモに自由記載）。Airで消えた古いメニューの受け皿
STAFF = re.compile("出勤|退勤|看護師|休診|休み|会議|ミーティング|研修|ブロック")
MARK = re.compile(r"Air予約番号:(\S+)")


def norm(x):
    x = unicodedata.normalize("NFKC", x or "")
    x = "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in x)
    return re.sub(r"[\s・･]", "", x)


def full(r):
    return unicodedata.normalize("NFKC", "".join(x for x in (r["lastNm"], r["firstNm"], r["lastNmKn"], r["firstNmKn"]) if x))


def is_staff(r):
    return bool(STAFF.search(full(r)))


def m3_of(r):
    """予約メモ先頭の3〜5桁（M3カルテ番号）。後ろが記号なら日付・時刻とみなして除く"""
    s = unicodedata.normalize("NFKC", r.get("bookingMemo") or "").strip()
    m = re.match(r"(\d{3,5})(?!\d)(.?)", s)
    if not m:
        return None
    nxt = m.group(2)
    if nxt and ((nxt.isascii() and not nxt.isspace()) or nxt in "〜ー：時分"):
        return None
    return m.group(1)


def iso(s):
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:00+09:00"


def lane_of(r):
    return next((LANE_ID[x.get("resrcSchdlId")] for x in r["resrcInfoList"] if x.get("resrcSchdlId") in LANE_ID), None)


def search_patients(q):
    r = req("GET", "patients", params={"q": q})  # 数字だけの検索をサーバーの防御が止めることがある → 空として扱う
    return r.json()["items"] if r is not None and r.status_code == 200 else []


def patient_for(r, c, menus):
    kana = norm((r["lastNmKn"] or "") + (r["firstNmKn"] or ""))
    name = norm((r["lastNm"] or "") + (r["firstNm"] or ""))
    n = m3_of(r)

    def same(p):
        pk, pn = norm(p.get("kana")), norm(p.get("name"))
        return pk == kana and (not name or not pn or pn in (name, kana))

    if n:
        hit = [p for p in search_patients(n) if p.get("m3ChartNo") == n and same(p)]
        if hit:
            c["患者：M3番号で一致"] += 1
            return hit[0]["id"]
    hit = [p for p in search_patients(kana) if same(p) and norm(p.get("name")) in (name or kana,)
           and not (n and p.get("m3ChartNo") and p.get("m3ChartNo") != n)] if kana else []
    if len(hit) == 1:
        c["患者：フリガナ・名前で一致"] += 1
        return hit[0]["id"]
    c["患者：新しく登録"] += 1
    if not APPLY:
        return None
    disp = ((r["lastNm"] or "") + " " + (r["firstNm"] or "")).strip() or ((r["lastNmKn"] or "") + " " + (r["firstNmKn"] or "")).strip()
    body = {"name": disp, "kana": ((r["lastNmKn"] or "") + " " + (r["firstNmKn"] or "")).strip()}
    if n and not search_patients(n):
        body.update({"chartNo": n, "m3ChartNo": n})
    try:
        return call("POST", "patients", json=body)["id"]
    except ApiError:
        body.pop("chartNo", None); body.pop("m3ChartNo", None)
        return call("POST", "patients", json=body)["id"]


def main():
    today = D.datetime.now(JST).date()
    end = today + D.timedelta(days=150)
    air_rows = air_fetch(today, end)
    air_by_no = {r["bookingNo"]: r for r in air_rows}
    login()
    menus = {m["id"] for m in call("GET", "settings")["menus"]}
    c = Counter()

    # 予約カレンダー側の、Airから来た今日以降の予約
    ours, notes = {}, {}
    d = today
    while d <= end:
        j = call("GET", "day", params={"date": d.isoformat()})
        notes[d.isoformat()] = j.get("dayNotes") or {}
        for x in j["reservations"]:
            m = MARK.search(x.get("memo") or "")
            if m:
                ours[m.group(1)] = x
        d += D.timedelta(1)

    for no, r in sorted(air_by_no.items(), key=lambda kv: kv[1]["bookingFromDt"]):
        confirmed = r["bookingStatusCd"] == "KeyCONFIRMED"
        x = ours.get(no)
        date = iso(r["bookingFromDt"])[:10]
        lane = lane_of(r)
        if is_staff(r):
            if not confirmed or not lane:
                continue
            line = f"{full(r)}（{iso(r['bookingFromDt'])[11:16]}〜{iso(r['bookingToDt'])[11:16]}）"
            cur = notes.get(date, {}).get(lane, "")
            if line in cur:
                continue
            c["スタッフの枠 → Todaysメモ"] += 1
            if APPLY:
                cur = (call("GET", f"day-notes/{date}").get("notes") or {}).get(lane, "")
                call("PUT", f"day-notes/{date}/{lane}", json={"text": (cur + ("\n" if cur else "") + line)[:1000]})
            continue
        menu = "menu-" + r["menuId"]
        head = ""
        if menu not in menus:
            menu, head = FREE_MENU, f"旧メニュー：{r.get('menuNm') or ''}\n"
        memo = (head + (r.get("bookingMemo") or "").strip() + "\n" + f"Air予約番号:{no}").strip()[-3000:]
        if x is None:
            if not confirmed:
                continue
            if not lane:
                c["担当（レーン）が分からず保留"] += 1
                continue
            c["新しい予約を追加"] += 1
            pid = patient_for(r, c, menus)
            if APPLY:
                call("POST", "reservations", json={"patientId": pid, "laneId": lane, "menuIds": [menu],
                                                   "startAt": iso(r["bookingFromDt"]), "endAt": iso(r["bookingToDt"]), "memo": memo})
            continue
        if x["status"] != "booked":
            if confirmed and x["status"] in ("cancelled", "no_show"):
                c["Airでは確定・予約カレンダーではキャンセル（院長に確認）"] += 1
            continue  # 来院・完了などは院の記録なので触らない
        if not confirmed:
            c["Airでキャンセル → キャンセルにする"] += 1
            if APPLY:
                call("PATCH", f"reservations/{x['id']}", json={"version": x["version"], "status": "cancelled"})
            continue
        patch = {}
        if x["startAt"][:16] != iso(r["bookingFromDt"])[:16] or x["endAt"][:16] != iso(r["bookingToDt"])[:16]:
            patch.update({"startAt": iso(r["bookingFromDt"]), "endAt": iso(r["bookingToDt"])})
        if lane and x["laneId"] != lane:
            patch["laneId"] = lane
        if x.get("menuIds") != [menu]:
            patch["menuIds"] = [menu]
        if (x.get("memo") or "").strip() != memo:
            patch["memo"] = memo
        if patch:
            c["Airで変更 → 直す"] += 1
            if APPLY:
                call("PATCH", f"reservations/{x['id']}", json={"version": x["version"], **patch})

    gone = [no for no in ours if no not in air_by_no and ours[no]["status"] == "booked"]
    if gone:
        c["Airに見当たらない予約（院長に確認・触らない）"] += len(gone)
    c = {k: v for k, v in c.items() if v}
    print(("【書き込みました】" if APPLY else "【試し運転：書き込んでいません】"), json.dumps(c, ensure_ascii=False) if c else "差分なし")


if __name__ == "__main__":
    main()
