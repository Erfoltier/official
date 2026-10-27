// LINE 公式アカウントの管理画面（chat.line.biz）で開いたチャットを、LANE RESERVE の患者に結びつける手がかりを送る。
// 送るのは「チャットの番号・トークに出ている予約申請ID・見出しの名前・プロフィール画像の見た目の指紋」だけ。トークの本文は送らない。
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
  // 相手のアイコン：トーク欄では相手の発言が左にアイコン付きで並び、院の発言は右に並ぶ。
  // トーク欄の中でいちばん左にあるアイコン（相手の発言の横）を使う。指紋は background.js で作る
  // トーク欄の範囲は、返信を書く入力欄の左右の端で決める（左のチャット一覧のアイコンを拾わないように）
  const box = document.querySelector("textarea");
  const pane = box && box.getBoundingClientRect();
  const icons = pane
    ? [...document.querySelectorAll("img")].filter((i) => {
        const r = i.getBoundingClientRect();
        return PIC.test(i.src) && r.width > 0 && r.left >= pane.left - 80 && r.right <= pane.left + pane.width * 0.35;
      })
    : [];
  const minLeft = Math.min(...icons.map((i) => i.getBoundingClientRect().left));
  const count = {};
  for (const i of icons) if (i.getBoundingClientRect().left <= minLeft + 40) count[i.src] = (count[i.src] || 0) + 1;
  const iconUrl = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || "";
  // 名前は、確実に読める場所がわかるまで送らない（画面上部の院のアカウント名を読まないように）
  const name = "";
  // トーク欄に出ている予約申請ID
  const ids = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const found = n.nodeValue.match(/R\d{14}[0-9A-F]{8}/gi);
    if (found && n.parentElement && inChatPane(n.parentElement)) found.forEach((s) => ids.add(s.toUpperCase()));
  }
  return { account: m[1], chatId: m[2], name: name.slice(0, 60), iconUrl, requestIds: [...ids].slice(0, 10) };
}

// 管理画面は画面を切り替えても URL だけが変わるので、2秒ごとに見て、変わったときだけ送る
setInterval(() => {
  const d = collect();
  if (!d) return;
  const key = [d.chatId, d.requestIds.join(","), d.iconUrl, d.name].join("|");
  if (key === lastKey) return;
  lastKey = key;
  // 何が読めたか（中身ではなく、あるかないか）を拡張機能の画面に出す
  chrome.storage.local.set({ scan: { at: new Date().toISOString(), ids: d.requestIds.length, icon: !!d.iconUrl, name: !!d.name } });
  chrome.runtime.sendMessage({ type: "learn", data: d });
}, 2000);
