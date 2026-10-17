"use client";

import { useEffect, useState } from "react";
import { ConsentPrint } from "@/components/consents/ConsentPrint";

/** 同意書の印刷ページ。ID は ?id= で受け取る（静的書き出しでも動くように） */
export default function Page() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    // URL を読めるのは表示後のため、ここで初期化する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(new URLSearchParams(window.location.search).get("id") ?? "");
  }, []);
  if (id === null) return null;
  return id ? <ConsentPrint id={id} /> : <p style={{ padding: 24 }}>同意書が指定されていません</p>;
}
