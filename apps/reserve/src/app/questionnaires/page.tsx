import type { Metadata } from "next";
import { QuestionnairesApp } from "@/components/questionnaires/QuestionnairesApp";

export const metadata: Metadata = { title: "問診票" };

export default function Page() {
  return <QuestionnairesApp />;
}
