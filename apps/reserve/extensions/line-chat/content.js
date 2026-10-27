// LINE 公式アカウントの管理画面（chat.line.biz）で開いたチャットを、LANE RESERVE の患者に結びつける手がかりを送る。
// 送るのは「チャットの番号・トークに出ている予約申請ID・見出しの名前・プロフィール画像の見た目の指紋」だけ。トークの本文は送らない。
// 管理画面の作りに左右されにくいよう、チャット一覧の列より右（トーク欄）にあるものだけを見る
let lastKey = "";

const PIC = /profile\.line-scdn\.net\/([A-Za-z0-9_-]{10,200})/;
function collect() {
  const m = location.pathname.match(/^\/(U[0-9a-f]{32})\/chat\/(U[0-9a-f]{32})/i);
  if (!m) return null;
  // 相手のアイコン：左のチャット一覧はいろいろな人のアイコンが縦に並ぶ列、その右がトーク欄で、相手の発言の横に
  // 相手のアイコンが出る。チャット一覧の列の右側で、いちばん左にあるアイコンを使う（右側の情報欄や院のアイコンは拾わない）。
  // 指紋は background.js で作る
  const all = [...document.querySelectorAll("img")].filter((i) => PIC.test(i.src) && i.getBoundingClientRect().width > 0);
  const cols = {};
  for (const i of all) {
    const k = Math.round(i.getBoundingClientRect().left / 50);
    (cols[k] = cols[k] || new Set()).add(i.src);
  }
  const listCol = Object.keys(cols).sort((x, y) => cols[y].size - cols[x].size)[0];
  const listRight = listCol !== undefined && cols[listCol].size >= 3
    ? Math.max(...all.filter((i) => Math.round(i.getBoundingClientRect().left / 50) === +listCol).map((i) => i.getBoundingClientRect().right))
    : window.innerWidth * 0.3;
  const icons = all.filter((i) => i.getBoundingClientRect().left > listRight + 10);
  const minLeft = Math.min(...icons.map((i) => i.getBoundingClientRect().left));
  const count = {};
  for (const i of icons) if (i.getBoundingClientRect().left <= minLeft + 40 && i.getBoundingClientRect().left < window.innerWidth * 0.6) count[i.src] = (count[i.src] || 0) + 1;
  const iconUrl = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || "";
  // 名前は、確実に読める場所がわかるまで送らない（画面上部の院のアカウント名を読まないように）
  const name = "";
  // トーク欄に出ている予約申請ID
  const ids = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const found = n.nodeValue.match(/R\d{14}[0-9A-F]{8}/gi);
    if (found && n.parentElement && n.parentElement.getBoundingClientRect().left > listRight + 10) found.forEach((s) => ids.add(s.toUpperCase()));
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
