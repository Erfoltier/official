"use client";

import { useEffect, useState } from "react";
import type { PatientFile } from "@/lib/domain/types";
import { ApiError, deleteFile, fileUrl } from "@/components/calendar/api";
import styles from "./files.module.css";

const ICON: Record<PatientFile["kind"], string> = { image: "🖼", pdf: "PDF", doc: "DOC" };

function sizeLabel(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** ファイルの小さな一覧。押すと写真は大きく表示、PDF は別タブ、Word はダウンロード */
export function FileThumbs(props: { files: PatientFile[]; canDelete?: boolean; onDeleted?: (id: string) => void; size?: "s" | "m" }) {
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = async (f: PatientFile) => {
    if (!window.confirm(`「${f.name}」を削除しますか？（記録としては残ります）`)) return;
    try {
      await deleteFile(f.id);
      setError(null);
      props.onDeleted?.(f.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除できませんでした");
    }
  };
  const images = props.files.filter((f) => f.kind === "image" && f.type !== "image/heic" && f.type !== "image/heif");
  if (props.files.length === 0) return null;
  return (
    <>
      <div className={styles.thumbs} data-size={props.size ?? "s"}>
        {props.files.map((f) => {
          const viewable = images.includes(f);
          const thumb = viewable ? (
            <button key={f.id} type="button" className={styles.thumb} onClick={() => setOpen(images.indexOf(f))} title={f.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(f.id)} alt={f.name} loading="lazy" />
            </button>
          ) : (
            <a
              key={f.id}
              className={styles.thumb}
              data-kind={f.kind}
              href={fileUrl(f.id)}
              target={f.kind === "pdf" ? "_blank" : undefined}
              rel="noopener"
              title={`${f.name}（${sizeLabel(f.size)}）`}
            >
              <span>{ICON[f.kind]}</span>
            </a>
          );
          return (
            <span key={f.id} className={styles.thumbWrap}>
              {thumb}
              {props.canDelete && (
                <button type="button" className={styles.thumbDel} onClick={() => remove(f)} aria-label={`${f.name}を削除`} title="削除">
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {open !== null && images[open] && (
        <Viewer
          files={images}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          canDelete={props.canDelete}
          onDeleted={(id) => {
            setOpen(null);
            props.onDeleted?.(id);
          }}
        />
      )}
    </>
  );
}

function Viewer(props: {
  files: PatientFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  canDelete?: boolean;
  onDeleted: (id: string) => void;
}) {
  const f = props.files[props.index];
  const [error, setError] = useState<string | null>(null);
  const { onClose, onIndex, index, files } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < files.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onIndex, index, files.length]);
  return (
    <div className={styles.viewer} role="dialog" aria-label={f.name} onClick={onClose}>
      <div className={styles.viewerBar} onClick={(e) => e.stopPropagation()}>
        <span className={styles.viewerName}>
          {f.name}
          {f.createdBy && `・${f.createdBy.name}`}
        </span>
        <span>
          {props.index + 1}/{props.files.length}
        </span>
        <a className={styles.viewerBtn} href={fileUrl(f.id)} target="_blank" rel="noopener">
          原寸
        </a>
        {props.canDelete && (
          <button
            type="button"
            className={styles.viewerBtn}
            onClick={async () => {
              if (!window.confirm(`「${f.name}」を削除しますか？（記録としては残ります）`)) return;
              try {
                await deleteFile(f.id);
                props.onDeleted(f.id);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "削除できませんでした");
              }
            }}
          >
            削除
          </button>
        )}
        <button type="button" className={styles.viewerBtn} onClick={props.onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.viewerImg} src={fileUrl(f.id)} alt={f.name} onClick={(e) => e.stopPropagation()} />
      {props.index > 0 && (
        <button type="button" className={styles.navPrev} onClick={(e) => (e.stopPropagation(), props.onIndex(props.index - 1))} aria-label="前へ">
          ‹
        </button>
      )}
      {props.index < props.files.length - 1 && (
        <button type="button" className={styles.navNext} onClick={(e) => (e.stopPropagation(), props.onIndex(props.index + 1))} aria-label="次へ">
          ›
        </button>
      )}
    </div>
  );
}
