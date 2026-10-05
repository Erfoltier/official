"use client";

import { useEffect, useRef } from "react";
import { PatientEditor } from "./PatientEditor";
import styles from "./patients.module.css";

/** カレンダーの上で患者情報を編集するためのダイアログ */
export function PatientDialog(props: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className={styles.dialog} onClose={props.onClose} onCancel={props.onClose} aria-label="患者情報の編集">
      <PatientEditor patientId={props.patientId} onClose={props.onClose} onSaved={props.onSaved} />
    </dialog>
  );
}
