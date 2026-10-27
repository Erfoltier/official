// 拡張機能から LANE RESERVE へ送る（管理画面のページからは直接送れないため、ここで送る）
const SERVER = "https://reserve.ishidahihuka.jp";

// 1.0.8 までこのパソコンだけに保存していた鍵を、同期の保存場所へ移す（入れ直し不要）
chrome.storage.local.get(["token"], ({ token }) => {
  if (!token) return;
  chrome.storage.sync.get(["token"], (cur) => {
    if (!cur.token) chrome.storage.sync.set({ token });
    chrome.storage.local.remove("token");
  });
});

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

/**
 * プロフィール画像の見た目の指紋（dHash）。LANE RESERVE の LineLink::dhash と同じ計算：
 * 64×64 → 9×8 に縮め、各行でとなりより明るいかの 8 ビット × 8 行を16進に。画像そのものは送らない
 */
async function dhash(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const mid = new OffscreenCanvas(64, 64);
  const mc = mid.getContext("2d");
  mc.imageSmoothingQuality = "high";
  mc.drawImage(bmp, 0, 0, 64, 64);
  const small = new OffscreenCanvas(9, 8);
  const sc = small.getContext("2d");
  sc.imageSmoothingQuality = "high";
  sc.drawImage(mid, 0, 0, 9, 8);
  const px = sc.getImageData(0, 0, 9, 8).data;
  let hex = "";
  for (let y = 0; y < 8; y++) {
    const row = [];
    for (let x = 0; x < 9; x++) {
      const i = (y * 9 + x) * 4;
      row.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    }
    let bits = 0;
    for (let x = 0; x < 8; x++) bits = (bits << 1) | (row[x] < row[x + 1] ? 1 : 0);
    hex += bits.toString(16).padStart(2, "0");
  }
  return hex;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "switch") {
    badge("…", "#888888");
    return;
  }
  if (!msg || msg.type !== "learn") return;
  // 鍵は Chrome の同期（院の Google アカウント）で全パソコンに配る。1台で保存すれば、ほかのパソコンでは入力不要
  chrome.storage.sync.get(["token"], async ({ token }) => {
    if (!token) return;
    let last;
    // アイコンの印で、いまの状態を見せる（…＝読み取り中、✓＝結びつけた、？＝特定できない、鍵＝鍵の問題）
    badge("…", "#888888");
    try {
      const { iconUrl, ...data } = msg.data;
      if (iconUrl) data.iconDhash = await dhash(iconUrl).catch(() => "");
      const r = await fetch(`${SERVER}/api/v1/integration/line-chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-Token": token },
        body: JSON.stringify(data),
      });
      const j = await r.json().catch(() => ({}));
      last = { at: new Date().toISOString(), status: r.status, ok: !!j.ok, how: j.how || "", reason: j.reason || "" };
    } catch (e) {
      last = { at: new Date().toISOString(), status: 0, ok: false, reason: String(e).slice(0, 80) };
    }
    chrome.storage.local.set({ last });
    if (last.ok) badge("✓", "#1a7f37");
    else if (last.status === 401) badge("鍵", "#c0392b");
    else badge("？", "#d97706");
  });
});
