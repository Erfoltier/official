// Chrome 拡張（extensions/ の各フォルダ）を、設定画面から配る zip にまとめる（build:static の前に自動で動く）。
// - line-chat：LINE チャット連携
// - m3-sync：デジカルへの写し（docs/M3-SYNC.md）
// フォルダを挟まずに入れる（「すべて展開」でできたフォルダをそのまま Chrome で選べるように）
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { zipSync } from "fflate";

mkdirSync("public/integrations", { recursive: true });
for (const [dir, out] of [
  ["line-chat", "line-chat-extension.zip"],
  ["m3-sync", "m3-sync-extension.zip"],
]) {
  const src = `extensions/${dir}`;
  const files = Object.fromEntries(readdirSync(src).map((f) => [f, readFileSync(`${src}/${f}`)]));
  writeFileSync(`public/integrations/${out}`, zipSync(files, { level: 9 }));
}
