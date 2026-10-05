import type { Metadata } from "next";
import { SettingsApp } from "@/components/settings/SettingsApp";

export const metadata: Metadata = { title: "設定｜予約カレンダー" };

export default function Page() {
  return <SettingsApp />;
}
