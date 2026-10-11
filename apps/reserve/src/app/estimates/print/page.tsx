"use client";

import { useEffect, useState } from "react";
import { EstimatePrint, type DocKind } from "@/components/estimates/EstimatePrint";

/** 見積書の印刷ページ。ID は ?id= で受け取る（静的書き出しでも動くように） */
export default function Page() {
  const [q, setQ] = useState<{ id: string; kind: DocKind } | null>(null);
  useEffect(() => {
    // URL を読めるのは表示後のため、ここで初期化する
    const sp = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQ({ id: sp.get("id") ?? "", kind: sp.get("type") === "bill" ? "bill" : "estimate" });
  }, []);
  if (q === null) return null;
  return q.id ? <EstimatePrint id={q.id} kind={q.kind} /> : <p style={{ padding: 24 }}>見積書が指定されていません</p>;
}
