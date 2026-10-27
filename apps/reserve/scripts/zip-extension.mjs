// Chrome 拡張「LINE チャット連携」（extensions/line-chat/）を、設定画面から配る zip にまとめる（build:static の前に自動で動く）
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { zipSync } from "fflate";

const src = "extensions/line-chat";
const files = Object.fromEntries(readdirSync(src).map((f) => [`lane-reserve-line-chat/${f}`, readFileSync(`${src}/${f}`)]));
mkdirSync("public/integrations", { recursive: true });
writeFileSync("public/integrations/line-chat-extension.zip", zipSync(files, { level: 9 }));
