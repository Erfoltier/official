/*
 * LANE RESERVE：サーバーや院のネットが止まっても、許可した端末で予約表の「画面」だけは開けるようにする（src/lib/offline.ts）。
 * - 画面の部品（/_next/static/…）はいったん読めたら端末に置く（名前が変われば別物なので古いものは自然に使われなくなる）
 * - ページ（HTML）はつながるときは毎回サーバーから。つながらないときだけ、最後に読めた控えを出す
 * - API（/api/…）は扱わない。患者の情報はここには置かない（暗号化した控えは offline.ts が IndexedDB に置く）
 */
const CACHE = "lane-reserve-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  if (url.pathname.includes("/_next/static/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(new URL("./", self.registration.scope).href))),
    );
  }
});
