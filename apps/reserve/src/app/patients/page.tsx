import type { Metadata } from "next";
import { PatientsApp } from "@/components/patients/PatientsApp";

export const metadata: Metadata = { title: "患者" };

export default function Page() {
  return <PatientsApp />;
}
