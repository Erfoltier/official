const $ = (id) => document.getElementById(id);

async function show() {
  const s = await chrome.storage.local.get(["enabled", "label", "status"]);
  $("enabled").checked = !!s.enabled;
  $("label").value = s.label || "";
  const st = s.status;
  $("status").textContent = st ? `${new Date(st.at).toLocaleString("ja-JP")}\n${st.message}` : "まだ動いていません";
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
