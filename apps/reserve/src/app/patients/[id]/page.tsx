import type { Metadata } from "next";
import Link from "next/link";
import { PatientEditor } from "@/components/patients/PatientEditor";
import styles from "@/components/patients/patients.module.css";

// 患者名をタブ名や履歴に残さないよう、タイトルは固定にする
export const metadata: Metadata = { title: "患者情報｜予約カレンダー" };

export default async function Page({ params }: PageProps<"/patients/[id]">) {
  const { id } = await params;
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <Link href="/patients" className={styles.back}>
          ← 患者一覧
        </Link>
        <Link href="/" className={styles.back}>
          カレンダーへ
        </Link>
      </header>
      <PatientEditor patientId={decodeURIComponent(id)} />
    </div>
  );
}
