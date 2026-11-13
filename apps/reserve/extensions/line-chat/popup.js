const HOW = { request: "予約申請IDで結びつけました", picture: "プロフィール画像で結びつけました", name: "表示名で結びつけました" };
const WHY = { not_found: "この人は LANE RESERVE でまだ特定できません", ambiguous: "別々の人の予約申請IDが見えたので結びつけませんでした", picture_mismatch: "プロフィール画像が合わないので結びつけませんでした", other_account: "別の公式アカウントです", invalid: "読み取れませんでした" };

let savedServer = "";

function show() {
  chrome.storage.sync.get(["token", "server"], ({ token, server }) => chrome.storage.local.get(["last", "scan"], ({ last, scan }) => {
    const el = document.getElementById("state");
    savedServer = server || "";
    document.getElementById("server").value = savedServer;
    if (!token) return (el.innerHTML = "<small>鍵がまだ保存されていません</small>");
    const seen = scan
      ? `<br><small>読み取れたもの：予約申請ID ${scan.ids}件・プロフィール画像 ${scan.icon ? "あり" : "なし"}・見出しの名前 ${scan.name ? "あり" : "なし"}</small>`
      : "<br><small>まだチャットを読み取っていません。管理画面のタブを再読み込み（F5）してから、チャットを開いてください</small>";
    if (!last) return (el.innerHTML = "<small>鍵は保存済みです。管理画面でチャットを開くと、自動で送ります</small>" + seen);
    const t = new Date(last.at).toLocaleString("ja-JP");
    const msg = last.status === 401 ? "鍵が正しくないか、止められています" : last.ok ? HOW[last.how] || "結びつけました" : WHY[last.reason] || `送れませんでした（${last.reason || last.status}）`;
    el.innerHTML = `<small>最後に開いたチャット（${t}）：${msg}</small>` + seen;
  }));
}

document.getElementById("save").addEventListener("click", async () => {
  const token = document.getElementById("token").value.trim();
  // 確認の画面（permissions.request）は押した直後に出す必要があるので、その前に待ち合わせをしない
  const server = document.getElementById("server").value.trim().replace(/\/+$/, "") || savedServer;
  if (!/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(server)) return alert("LANE RESERVE のアドレス（https:// で始まる）を入れてください");
  if (token && !/^lc_[0-9a-f]{40}$/.test(token)) return alert("lc_ で始まる鍵を貼ってください");
  // 院のアドレスへ送ってよいかを Chrome に確かめる（初めてのアドレスのときだけ確認の画面が出る）
  const origin = new URL(server).origin + "/*";
  const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!ok) return alert("このアドレスへの送信が許可されませんでした");
  await chrome.storage.local.set({ last: null });
  await chrome.storage.sync.set(token ? { server, token } : { server });
  document.getElementById("token").value = "";
  show();
});
show();
