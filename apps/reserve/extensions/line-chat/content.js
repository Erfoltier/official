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
  // チャット一覧の右端：アイコンの列だけでなく、その横の名前・最後のメッセージ（ほかの患者の申請IDが出る）まで含む枠の右端。
  // 一覧のアイコンをすべて含むいちばん内側の枠を一覧とみなす
  let listRight = window.innerWidth * 0.3;
  if (listCol !== undefined && cols[listCol].size >= 3) {
    const listIcons = all.filter((i) => Math.round(i.getBoundingClientRect().left / 50) === +listCol);
    listRight = Math.max(...listIcons.map((i) => i.getBoundingClientRect().right));
    let box = listIcons[0].parentElement;
    while (box && box !== document.body && !listIcons.every((i) => box.contains(i))) box = box.parentElement;
    if (box && box !== document.body) {
      const r = box.getBoundingClientRect().right;
      if (r < window.innerWidth * 0.6) listRight = Math.max(listRight, r);
    }
  }
  const icons = all.filter((i) => i.getBoundingClientRect().left > listRight + 10);
  const minLeft = Math.min(...icons.map((i) => i.getBoundingClientRect().left));
  const count = {};
  for (const i of icons) if (i.getBoundingClientRect().left <= minLeft + 40 && i.getBoundingClientRect().left < window.innerWidth * 0.6) count[i.src] = (count[i.src] || 0) + 1;
  const iconUrl = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || "";
  // 名前は、確実に読める場所がわかるまで送らない（画面上部の院のアカウント名を読まないように）
  const name = "";
  // トーク欄に出ている予約申請ID（相手のアイコンが見えていれば、その左端より右だけ。トークの吹き出しはアイコンの右に出る）
  const talkLeft = iconUrl ? Math.max(listRight + 10, minLeft - 20) : listRight + 10;
  const ids = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const found = n.nodeValue.match(/R\d{14}[0-9A-F]{8}/gi);
    const r = found && n.parentElement ? n.parentElement.getBoundingClientRect() : null;
    if (r && r.width > 0 && r.left > talkLeft) found.forEach((s) => ids.add(s.toUpperCase()));
  }
  return { account: m[1], chatId: m[2], name: name.slice(0, 60), iconUrl, requestIds: [...ids].slice(0, 10) };
}

// 管理画面はチャットを切り替えても、ページは読み込み直さず（F5 にならず）、URL が先に変わって中身があとから入れ替わる。
// 1秒ごとに読み、同じ内容が2回続いた（画面が落ち着いた）ときだけ送る。切り替えの途中で前の人のアイコンを送らないように
// 前のチャットで読めたアイコン・予約申請IDが新しいチャットでも見えたら、入れ替わる前の画面の残りとみなして使わない
// （1人に1チャットなので、別のチャットに同じ人のものは出ない）
let pendingKey = "";
let curChat = "";
let prev = { chatId: "", iconUrl: "", ids: [] };
let shown = { chatId: "", iconUrl: "", ids: [] };
setInterval(() => {
  const d = collect();
  if (!d) return;
  if (d.chatId !== curChat) {
    // 別の患者のチャットに移った：読み取り中の印を出し、前のチャットの読み取り結果を覚えておく
    if (curChat) prev = shown.chatId === curChat ? shown : { chatId: curChat, iconUrl: "", ids: [] };
    curChat = d.chatId;
    chrome.runtime.sendMessage({ type: "switch" });
  }
  if (prev.chatId && prev.chatId !== d.chatId) {
    if (d.iconUrl && d.iconUrl === prev.iconUrl) d.iconUrl = "";
    d.requestIds = d.requestIds.filter((x) => !prev.ids.includes(x));
  }
  shown = { chatId: d.chatId, iconUrl: d.iconUrl || (shown.chatId === d.chatId ? shown.iconUrl : ""), ids: d.requestIds };
  const key = [d.chatId, d.requestIds.join(","), d.iconUrl, d.name].join("|");
  if (key !== pendingKey) {
    pendingKey = key;
    return;
  }
  if (key === lastKey) return;
  lastKey = key;
  // 何が読めたか（中身ではなく、あるかないか）を拡張機能の画面に出す
  chrome.storage.local.set({ scan: { at: new Date().toISOString(), ids: d.requestIds.length, icon: !!d.iconUrl, name: !!d.name } });
  chrome.runtime.sendMessage({ type: "learn", data: d });
}, 1000);
