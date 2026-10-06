import os, re, sys, json, requests
B = "https://lolipopftp.lolipop.jp"
s = requests.Session()
s.headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36"

def login():
    s.get(B + "/")
    r = s.post(B + "/auth/login", data={"ftp_account": os.environ["LOLIPOP_ID"], "ftp_password": os.environ["LOLIPOP_PASSWORD"]})
    assert "誤りがあります" not in r.text, "login failed"

def cd(path):  # path like "ishidahihuka.jp/reserve/"
    r = s.get(B + "/dir/root/" + path)
    r.raise_for_status()
    return r.text

def listing(path):
    t = cd(path)
    return sorted(set(re.findall(r'href="/(?:dir|file/edit)/root/' + re.escape(path) + r'([^"/]+/?)"', t)))

def read(path):  # path like "ishidahihuka.jp/reserve/.htaccess"。なければ None
    import html
    r = s.get(B + "/file/edit/root/" + path)
    m = re.search(r'<textarea[^>]*name="body"[^>]*>(.*?)</textarea>', r.text, re.S)
    return html.unescape(m.group(1)) if m else None

def mkdir(name, perm="705"):
    t = s.get(B + "/dir/make/").text
    tok = re.search(r'name="id" value="([^"]*)"', t).group(1)
    r = s.post(B + "/dir/make/", data={"dirName": name, "permission": perm, "make": "exec", "id": tok})
    return r

def upload_path():
    t = s.get(B + "/file/upload/").text
    m = re.search(r'アップロードする場所.*?(/[^<\s]*/)', t, re.S)
    return m.group(1) if m else None

def upload(local, name=None):
    with open(local, "rb") as f:
        r = s.post(B + "/uploader/server/index.php", files={"files[]": (name or os.path.basename(local), f, "application/octet-stream")},
                   headers={"X-Requested-With": "XMLHttpRequest", "Referer": B + "/file/upload/"})
    return r

def put(local, name=None):
    name = name or os.path.basename(local)
    r = upload(local, name)
    info = r.json()["files"][0]
    c = s.post(B + "/file/commit/", data={"temp_file_name": info["name"], "file_name": info["true_name"]}, headers={"X-Requested-With": "XMLHttpRequest"})
    if "success" not in c.text:
        raise RuntimeError(f"commit failed {name}: {c.text[:200]}")
    a = s.post(B + "/file/after/", data={"fileName": name, "fileID": info["name"]}, headers={"X-Requested-With": "XMLHttpRequest"})
    return a.text
