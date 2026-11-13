"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./files.module.css";

/**
 * パソコン・タブレットのカメラで撮影する（ブラウザの中にカメラの映像を出す）。
 * 撮ったら確認して「この写真を使う」。続けて何枚でも撮れる。
 */
export function CameraDialog(props: { onShot: (blob: Blob) => Promise<void> | void; onClose: () => void; onUnavailable: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const { onUnavailable } = props;

  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      onUnavailable();
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch((err: DOMException) => {
        setError(
          err?.name === "NotAllowedError"
            ? "カメラの使用が許可されていません。ブラウザのアドレス欄のカメラの印から許可してください"
            : "カメラが見つかりません。カメラがつながっているか確認してください",
        );
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, onUnavailable]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const take = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && setShot({ blob: b, url: URL.createObjectURL(b) }), "image/jpeg", 0.9);
  };

  return (
    <div className={styles.camera} role="dialog" aria-label="カメラで撮影">
      <div className={styles.cameraStage}>
        <video ref={videoRef} playsInline muted className={styles.cameraVideo} hidden={!!shot} />
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.url} alt="撮影した写真" className={styles.cameraVideo} />
        )}
        {error && <div className={styles.cameraError}>{error}</div>}
      </div>
      <div className={styles.cameraBar}>
        <button type="button" className={styles.viewerBtn} onClick={props.onClose}>
          閉じる{count > 0 && `（${count}枚 保存済み）`}
        </button>
        {shot ? (
          <>
            <button type="button" className={styles.viewerBtn} onClick={() => setShot(null)} disabled={busy}>
              撮り直す
            </button>
            <button
              type="button"
              className={styles.useBtn}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await props.onShot(shot.blob);
                setBusy(false);
                setCount((n) => n + 1);
                setShot(null);
              }}
            >
              {busy ? "保存中…" : "この写真を使う"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.viewerBtn} onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>
              カメラ切替
            </button>
            <button type="button" className={styles.shutter} onClick={take} disabled={!!error} aria-label="撮影する" />
          </>
        )}
      </div>
    </div>
  );
}
