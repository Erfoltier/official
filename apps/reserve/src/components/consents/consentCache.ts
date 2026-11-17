"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConsentTemplateWithHtml } from "@/lib/domain/types";
import { fetchConsentTemplate, fetchConsentTemplates, type ConsentTemplateList } from "@/components/calendar/api";

/**
 * 同意書のひな形の一覧・本文を、画面を開いている間おぼえておく。
 * 開いたときは前回の内容をすぐ出し、そのあとドライブの最新を取りに行って、違っていれば差し替える。
 * （患者の情報は入らない。ひな形の文面だけ）
 */
let listCache: ConsentTemplateList | null = null;
let listCheckedAt = 0;
let listInFlight: Promise<ConsentTemplateList> | null = null;
const docCache = new Map<string, ConsentTemplateWithHtml & { stale?: boolean }>();

/** ドライブの最新を見に行く間隔（これより短い間に開き直したときは見に行かない） */
const RECHECK_MS = 30_000;

function refreshList(): Promise<ConsentTemplateList> {
  listInFlight ??= fetchConsentTemplates()
    .then((r) => {
      listCache = r;
      listCheckedAt = Date.now();
      return r;
    })
    .finally(() => {
      listInFlight = null;
    });
  return listInFlight;
}

/** 一覧：すぐ出す内容と、最新を確認中かどうか */
export function useConsentTemplates() {
  const [data, setData] = useState<ConsentTemplateList | null>(listCache);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async (force = false) => {
    if (!force && listCache && Date.now() - listCheckedAt < RECHECK_MS) return;
    setChecking(true);
    try {
      setData(await refreshList());
    } catch (err) {
      setError(err);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 前回の内容がなければ、まずサーバーに保存してある内容をすぐもらう
      if (!listCache) {
        try {
          const quick = await fetchConsentTemplates({ cached: true });
          if (!listCache) listCache = quick;
          if (alive) setData(listCache);
        } catch (err) {
          if (alive) setError(err);
        }
      }
      if (alive) await reload();
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  return { data, checking, error, reload: () => reload(true) };
}

/** 本文：前回の本文をすぐ渡し（onQuick）、最新を読み込んだら渡す（戻り値）。違っていれば changed */
export async function loadConsentDoc(
  id: string,
  onQuick: (t: ConsentTemplateWithHtml & { stale?: boolean }) => void,
): Promise<{ doc: ConsentTemplateWithHtml & { stale?: boolean }; changed: boolean }> {
  let quick = docCache.get(id);
  if (!quick) {
    try {
      const c = await fetchConsentTemplate(id, { cached: true });
      if (c.html) quick = c;
    } catch {
      /* 最新を読みに行く */
    }
  }
  if (quick) onQuick(quick);
  const latest = await fetchConsentTemplate(id);
  if (latest.html) docCache.set(id, latest);
  return { doc: latest.html ? latest : (quick ?? latest), changed: !!quick && !!latest.html && latest.html !== quick.html };
}

/** 設定を変えたあとなど、次に開いたときに必ず最新を取りに行く */
export function invalidateConsentTemplates() {
  listCheckedAt = 0;
}
