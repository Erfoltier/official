import sys, re, os
sys.path.insert(0, os.path.dirname(__file__))
from lp import *

BASE = "ishidahihuka.jp/reserve/"
APP = "/home/user/official/apps/reserve"
NEVER = {"config.php", "data"}          # サーバー上のデータ・鍵には触れない

def rows(path):
    t = cd(path); i = t.find('dirListTable'); t = t[i:t.find('すべて選択する', i)]
    out = {}
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        c = [x for x in (re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', y)).strip() for y in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)) if x]
        if len(c) >= 4 and re.match(r'\d{4}/', c[1]): out[c[0]] = c[2]
    return out

def delete(path, name):
    t = s.get(B + "/file/edit/root/" + path + name).text
    v = re.search(r'name="delFile" value="([^"]+)"', t).group(1)
    assert v.startswith("/" + path + name), v
    s.post(B + "/file/delete/", data={"delFile": v})

# 入口の鍵（Basic認証）の設定。サーバー上の reserve/.htaccess の先頭にあり、反映のたびに引き継ぐ。
# （鍵ファイルの場所にアカウント名が入るので、リポジトリには置かない）
AUTH_BEGIN, AUTH_END = "# BEGIN reserve-auth", "# END reserve-auth"
AUTH_LINE = re.compile(r"^\s*(AuthType|AuthName|AuthUserFile|AuthGroupFile|Require|Satisfy)\b", re.I)

def auth_block(cur):
    """サーバー上の .htaccess から鍵の設定を取り出す（目印の間。なければロリポップの画面で足された行）"""
    if AUTH_BEGIN in cur and AUTH_END in cur:
        return cur[cur.index(AUTH_BEGIN):cur.index(AUTH_END) + len(AUTH_END)]
    lines = [l for l in cur.splitlines() if AUTH_LINE.match(l)]
    return AUTH_BEGIN + "\n" + "\n".join(lines) + "\n" + AUTH_END if lines else ""

def with_auth(block, local, tmpdir):
    out = os.path.join(tmpdir, ".htaccess")
    with open(local, encoding="utf-8") as f:
        body = f.read()
    with open(out, "w", encoding="utf-8") as f:
        f.write(block + "\n\n" + body)
    return out

def keep_auth(local, tmpdir):
    """サーバー上の鍵の設定を、手元の .htaccess の先頭に付けた一時ファイルを返す"""
    block = auth_block(read(BASE + ".htaccess") or "")
    return (with_auth(block, local, tmpdir), 1) if block else (local, 0)

def sync(files):
    """files: [(サーバー上の相対パス, 手元のファイル, 置き換えるか)]"""
    login()
    import tempfile
    tmp = tempfile.mkdtemp()
    files = [(rel, *keep_auth(local, tmp)[:1], rep) if rel == ".htaccess" else (rel, local, rep) for rel, local, rep in files]
    bydir = {}
    for rel, local, replace in files:
        d, n = os.path.split(rel)
        assert d.split("/")[0] not in NEVER and rel not in NEVER, rel
        bydir.setdefault(d, []).append((n, local, replace))
    stats = {"new": 0, "replaced": 0, "skipped": 0}
    for d in sorted(bydir, key=lambda x: (x.count("/"), x)):
        # フォルダがなければ作る
        parts = [p for p in d.split("/") if p]
        for i in range(len(parts)):
            parent = BASE + "".join(p + "/" for p in parts[:i])
            if parts[i] not in rows(parent):
                cd(parent); mkdir(parts[i], "705")
        path = BASE + "".join(p + "/" for p in parts)
        have = rows(path)
        for n, local, replace in bydir[d]:
            if n in have and not replace:
                stats["skipped"] += 1; continue
            if n in have:
                delete(path, n); stats["replaced"] += 1
            else:
                stats["new"] += 1
            cd(path); s.get(B + "/file/upload/")
            s.post(B + "/file/upload/", data={"mode": "transType", "transType": "2"})
            s.post(B + "/file/upload/", data={"mode": "overWright", "overWright": "0"})
            put(local, n)
        after = rows(path)
        for n, local, _ in bydir[d]:
            if after.get(n) != str(os.path.getsize(local)):
                raise RuntimeError(f"size mismatch {path}{n}: {after.get(n)} vs {os.path.getsize(local)}")
    return stats

if __name__ == "__main__":
    files = []
    out = APP + "/out"
    for d, _, fs in os.walk(out):
        for f in fs:
            local = os.path.join(d, f); rel = os.path.relpath(local, out)
            hashed = rel.startswith("_next/static/chunks/") or rel.startswith("_next/static/media/")
            files.append((rel, local, not hashed))
    libs = sorted("lib/" + f for f in os.listdir(APP + "/php/lib") if f.endswith(".php"))
    for rel in libs + ["lib/.htaccess", "api/index.php", "seed/seed.json", "seed/.htaccess", "cron/reminders.php", "cron/.htaccess", ".htaccess"]:
        files.append((rel, APP + "/php/" + rel, True))
    print(sync(files))
