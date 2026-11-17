import type { Metadata } from "next";
import { SettingsApp } from "@/components/settings/SettingsApp";

export const metadata: Metadata = { title: "設定" };

export default function Page() {
  return <SettingsApp />;
}
