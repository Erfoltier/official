import type { Metadata } from "next";
import { LoginApp } from "@/components/auth/LoginApp";

export const metadata: Metadata = { title: "ログイン｜予約カレンダー" };

export default function Page() {
  return <LoginApp />;
}
