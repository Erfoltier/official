// LINE 公式アカウントの管理画面（chat.line.biz）で開いたチャットを、LANE RESERVE の患者に結びつける手がかりを送る。
// 送るのは「チャットの番号・トークに出ている予約申請ID・見出しの名前・プロフィール画像の番号」だけ。トークの本文は送らない。
// 管理画面の作りに左右されにくいよう、画面の右側（トークの欄。左はチャット一覧）にあるものだけを見る
let lastKey = "";

const PIC = /profile\.line-scdn\.net\/([A-Za-z0-9_-]{10,200})/;
const inChatPane = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.left > window.innerWidth * 0.3;
};

function collect() {
  const m = location.pathname.match(/^\/(U[0-9a-f]{32})\/chat\/(U[0-9a-f]{32})/i);
  if (!m) return null;
  // 相手のプロフィール画像：トーク欄でいちばん多く出ている画像（相手の発言の横に並ぶ）
  const count = {};
  for (const img of document.querySelectorAll('img[src*="profile.line-scdn.net"]')) {
    const h = (img.src.match(PIC) || [])[1];
    if (h && inChatPane(img)) count[h] = (count[h] || 0) + 1;
  }
  const icon = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || "";
  // 見出しの名前：トーク欄の上の header の1行目
  const header = [...document.querySelectorAll("header")].filter(inChatPane).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  const name = ((header && header.innerText) || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  // トーク欄に出ている予約申請ID
  const ids = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const found = n.nodeValue.match(/R\d{14}[0-9A-F]{8}/gi);
    if (found && n.parentElement && inChatPane(n.parentElement)) found.forEach((s) => ids.add(s.toUpperCase()));
  }
  return { account: m[1], chatId: m[2], name: name.slice(0, 60), iconHash: icon, requestIds: [...ids].slice(0, 10) };
}

// 管理画面は画面を切り替えても URL だけが変わるので、2秒ごとに見て、変わったときだけ送る
setInterval(() => {
  const d = collect();
  if (!d) return;
  const key = [d.chatId, d.requestIds.join(","), d.iconHash, d.name].join("|");
  if (key === lastKey) return;
  lastKey = key;
  // 何が読めたか（中身ではなく、あるかないか）を拡張機能の画面に出す
  chrome.storage.local.set({ scan: { at: new Date().toISOString(), ids: d.requestIds.length, icon: !!d.iconHash, name: !!d.name } });
  chrome.runtime.sendMessage({ type: "learn", data: d });
}, 2000);
