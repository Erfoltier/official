// LINE 公式アカウントの管理画面（chat.line.biz）で開いたチャットを、LANE RESERVE の患者に結びつける手がかりを送る。
// 送るのは「チャットの番号・トークに出ている予約申請ID・見出しの名前・プロフィール画像の番号」だけ。トークの本文は送らない
let lastKey = "";

/** トーク側の見出し（プロフィール画像のある header のうち、いちばん右のもの） */
function chatHeader() {
  const hs = [...document.querySelectorAll("header")].filter((h) => h.querySelector('img[src*="profile.line-scdn.net"]'));
  hs.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
  return hs[0] || null;
}

function collect() {
  const m = location.pathname.match(/^\/(U[0-9a-f]{32})\/chat\/(U[0-9a-f]{32})/i);
  const h = m && chatHeader();
  if (!h) return null;
  const img = h.querySelector('img[src*="profile.line-scdn.net"]');
  const icon = ((img && img.src.match(/profile\.line-scdn\.net\/([A-Za-z0-9_-]{10,200})/)) || [])[1] || "";
  const name = (h.innerText || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  const pane = h.parentElement;
  const ids = [...new Set(((pane && pane.innerText) || "").match(/R\d{14}[0-9A-F]{8}/gi) || [])].map((s) => s.toUpperCase()).slice(0, 10);
  return { account: m[1], chatId: m[2], name: name.slice(0, 60), iconHash: icon, requestIds: ids };
}

// 管理画面は画面を切り替えても URL だけが変わるので、2秒ごとに見て、変わったときだけ送る
setInterval(() => {
  const d = collect();
  if (!d) return;
  const key = [d.chatId, d.requestIds.join(","), d.iconHash, d.name].join("|");
  if (key === lastKey) return;
  lastKey = key;
  chrome.runtime.sendMessage({ type: "learn", data: d });
}, 2000);
