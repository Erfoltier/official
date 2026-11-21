const $ = (id) => document.getElementById(id);

async function show() {
  const s = await chrome.storage.local.get(["enabled", "label", "status", "usage"]);
  $("enabled").checked = !!s.enabled;
  $("label").value = s.label || "";
  const st = s.status;
  const u = s.usage;
  const month = new Date().toISOString().slice(0, 7);
  let usage = "";
  if (u && u.month === month) {
    usage = `\n今月の Claude：約${Math.round(u.yen)}円（${u.calls}回・上限 ${u.capYen.toLocaleString()}円）`;
    if (u.paused) usage += "\n⚠ 上限に達したため、受付メモを作るのを止めています";
    else if (u.warnings?.length) usage += `\n⚠ 今月の利用が約${u.warnings[u.warnings.length - 1].yen.toLocaleString()}円を超えました`;
  }
  $("status").textContent = (st ? `${new Date(st.at).toLocaleString("ja-JP")}\n${st.message}` : "まだ動いていません") + usage;
}

$("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$("label").addEventListener("change", (e) => chrome.storage.local.set({ label: e.target.value.trim() }));
$("run").addEventListener("click", async () => {
  $("status").textContent = "写しています…";
  await chrome.runtime.sendMessage({ type: "run-now" });
  show();
});
chrome.storage.onChanged.addListener(show);
show();
