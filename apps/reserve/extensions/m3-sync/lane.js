// LANE RESERVE の画面に入り、ログイン中のスタッフとして写しの API を呼ぶ（鍵は使わない。docs/M3-SYNC.md）
if (!globalThis.__laneM3Bridge) {
  globalThis.__laneM3Bridge = true;
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "lane-api") return false;
  (async () => {
    try {
      const res = await fetch(location.origin + msg.path, {
        method: msg.method || "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(msg.headers || {}) },
        body: msg.body === undefined ? undefined : JSON.stringify(msg.body),
      });
      const data = await res.json().catch(() => ({}));
      reply({ ok: res.ok, status: res.status, data });
    } catch (e) {
      reply({ ok: false, status: 0, data: { message: String(e) } });
    }
  })();
  return true;
});
}
