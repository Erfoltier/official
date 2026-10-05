import type { Metadata } from "next";
import { PatientsApp } from "@/components/patients/PatientsApp";

export const metadata: Metadata = { title: "患者｜予約カレンダー" };

export default function Page() {
  return <PatientsApp />;
}
