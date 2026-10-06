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

def sync(files):
    """files: [(サーバー上の相対パス, 手元のファイル, 置き換えるか)]"""
    login()
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
    for rel in libs + ["api/index.php", "seed/seed.json", ".htaccess"]:
        files.append((rel, APP + "/php/" + rel, True))
    print(sync(files))
