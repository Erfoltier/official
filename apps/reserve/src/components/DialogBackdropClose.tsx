"use client";

import { useEffect } from "react";

/**
 * 画面中央の窓（<dialog>）の外の暗いところを押したら、その窓を閉じる（× を押したのと同じ扱い）。
 * 窓の中で押し始めて外で離した（文字を選んでいた）ときは閉じない
 */
export function DialogBackdropClose() {
  useEffect(() => {
    let downOnBackdrop: HTMLDialogElement | null = null;
    const outside = (d: HTMLDialogElement, e: PointerEvent | MouseEvent) => {
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      downOnBackdrop = t instanceof HTMLDialogElement && t.open && outside(t, e) ? t : null;
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof HTMLDialogElement && t.open && t === downOnBackdrop && outside(t, e)) t.close();
      downOnBackdrop = null;
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
