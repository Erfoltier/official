"use client";

import { useRef, useState } from "react";
import type { PatientFile } from "@/lib/domain/types";
import { ApiError, uploadFile } from "@/components/calendar/api";
import { ACCEPT_FILES, prepareFile } from "./prepare";
import styles from "./files.module.css";

/**
 * ファイルの追加：撮影（スマホ・iPadのカメラ）、端末のファイルを選ぶ、ドラッグ＆ドロップ。
 * 写真は縮小してから送る。
 */
export function FileUploader(props: {
  patientId: string;
  date: string;
  reservationId?: string;
  compact?: boolean;
  onUploaded: (f: PatientFile) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const send = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;
    setError(null);
    for (const [i, f] of list.entries()) {
      setBusy(list.length > 1 ? `送信中 ${i + 1}/${list.length}…` : "送信中…");
      try {
        const { blob, name } = await prepareFile(f);
        props.onUploaded(await uploadFile(props.patientId, { date: props.date, reservationId: props.reservationId }, blob, name));
      } catch (err) {
        setError(`${f.name}：${err instanceof ApiError ? err.message : "送れませんでした"}`);
      }
    }
    setBusy(null);
  };

  return (
    <div
      className={styles.uploader}
      data-compact={props.compact || undefined}
      data-over={over || undefined}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        send(e.dataTransfer.files);
      }}
    >
      <div className={styles.uploadBtns}>
        <button type="button" className={styles.camBtn} onClick={() => cameraRef.current?.click()} disabled={!!busy}>
          📷 撮影
        </button>
        <button type="button" className={styles.pickBtn} onClick={() => pickRef.current?.click()} disabled={!!busy}>
          📎 ファイル
        </button>
      </div>
      {!props.compact && <div className={styles.dropHint}>写真・PDF・Word をここにドラッグしても追加できます（10MBまで）</div>}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          if (e.target.files) send(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={pickRef}
        type="file"
        accept={ACCEPT_FILES}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) send(e.target.files);
          e.target.value = "";
        }}
      />
      {busy && <div className={styles.busy}>{busy}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
