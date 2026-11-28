"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 端末ごとに覚えておく表示設定（拡大率・氏名を伏せる等）。
 * 患者情報はここに保存しない。保存できない環境（プライベートモード等）では既定値で動く。
 */
export function usePref<T>(key: string, initial: T, validate: (v: unknown) => v is T) {
  const storageKey = `reserve:pref:${key}`;
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      // 保存値の復元はマウント後にしか行えない（サーバー描画と一致させるため）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (validate(parsed)) setValue(parsed);
    } catch {
      /* 既定値のまま */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(v));
        } catch {
          /* 保存できなくても動作は続ける */
        }
        return v;
      });
    },
    [storageKey],
  );

  return [value, update] as const;
}

export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isString = (v: unknown): v is string => typeof v === "string";
