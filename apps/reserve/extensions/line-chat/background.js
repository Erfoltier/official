// 拡張機能から LANE RESERVE へ送る（管理画面のページからは直接送れないため、ここで送る）
const SERVER = "https://reserve.ishidahihuka.jp";

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "learn") return;
  chrome.storage.local.get(["token"], async ({ token }) => {
    if (!token) return;
    let last;
    try {
      const r = await fetch(`${SERVER}/api/v1/integration/line-chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Token": token },
        body: JSON.stringify(msg.data),
      });
      const j = await r.json().catch(() => ({}));
      last = { at: new Date().toISOString(), status: r.status, ok: !!j.ok, how: j.how || "", reason: j.reason || "" };
    } catch (e) {
      last = { at: new Date().toISOString(), status: 0, ok: false, reason: String(e).slice(0, 80) };
    }
    chrome.storage.local.set({ last });
    chrome.action.setBadgeText({ text: last.ok ? "✓" : last.status === 401 ? "鍵" : "" });
  });
});
