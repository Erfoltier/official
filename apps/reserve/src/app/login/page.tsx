import type { Metadata } from "next";
import { LoginApp } from "@/components/auth/LoginApp";

export const metadata: Metadata = { title: "ログイン" };

export default function Page() {
  return <LoginApp />;
}
