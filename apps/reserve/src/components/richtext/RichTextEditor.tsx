"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { DEFAULT_TEXT_COLOR, TEXT_COLORS, normalizeColor, normalizeRich, richToPlain, toEditableHtml } from "@/lib/domain/richtext";
import { usePref } from "@/components/calendar/usePref";
import styles from "./richtext.module.css";

const isColorList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && /^#[0-9a-f]{6}$/.test(x));
const MAX_CUSTOM = 8;

interface Props {
  value: string;
  onChange(v: string): void;
  onBlur?(): void;
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  placeholder?: string;
  /** 文字数の上限（装飾を除いた文字で数える） */
  maxLength?: number;
  ariaLabel: string;
  autoFocus?: boolean;
  /** 最低の高さ（行） */
  rows?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * 太字・斜体・下線・文字色（12色＋自分で作った色）を付けられるメモ欄。
 * 保存する値は決まった小さな HTML（装飾がなければただの文字）
 */
export function RichTextEditor(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  /** 最後に親へ渡した値（親から同じ値が戻ってきたら中身を入れ直さない） */
  const emitted = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [custom, setCustom] = usePref<string[]>("textColors", [], isColorList);
  const [empty, setEmpty] = useState(!richToPlain(props.value));
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** カーソル位置の文字が太字・斜体・下線か（ボタンの押された見た目に使う） */
  const [on, setOn] = useState({ b: false, i: false, u: false });
  const readState = useCallback(() => {
    try {
      setOn({ b: document.queryCommandState("bold"), i: document.queryCommandState("italic"), u: document.queryCommandState("underline") });
    } catch {
      /* 調べられない端末では押された見た目を出さない */
    }
  }, []);
  const length = richToPlain(props.value).length;

  // 親から値が変わったとき（初回・貼り付け欄からの入力など）だけ中身を入れ直す
  useEffect(() => {
    const el = ref.current;
    if (!el || props.value === emitted.current) return;
    el.innerHTML = toEditableHtml(props.value);
    emitted.current = props.value;
    setEmpty(!richToPlain(props.value));
  }, [props.value]);

  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, [props.autoFocus]);

  // 選んでいる範囲を覚えておく（色を選ぶ窓を開くと選択が外れるため）
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
        range.current = sel.getRangeAt(0).cloneRange();
        readState();
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [readState]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const v = normalizeRich(el.innerHTML);
    emitted.current = v;
    setEmpty(!richToPlain(v));
    props.onChange(v);
  }, [props]);

  const restore = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = document.getSelection();
    if (sel && range.current) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const exec = (cmd: string, value?: string) => {
    if (props.disabled) return;
    restore();
    document.execCommand("styleWithCSS", false, cmd === "foreColor" ? "true" : "false");
    document.execCommand(cmd, false, value);
    emit();
    readState();
  };

  const applyColor = (c: string) => exec("foreColor", c);

  const addCustom = (c0: string) => {
    const c = normalizeColor(c0);
    if (!c) return;
    setCustom((xs) => [c, ...xs.filter((x) => x !== c)].slice(0, MAX_CUSTOM));
    applyColor(c);
  };

  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className={`${styles.editor} ${props.className ?? ""}`} data-disabled={props.disabled || undefined}>
      <div
        ref={ref}
        className={styles.area}
        contentEditable={!props.disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={props.ariaLabel}
        data-empty={empty || undefined}
        data-placeholder={props.placeholder ?? ""}
        style={{ minHeight: `${(props.rows ?? 3) * 1.6 + 0.8}em` }}
        onInput={emit}
        onBlur={props.onBlur}
        onKeyDown={props.onKeyDown}
        onPaste={(e) => {
          // 貼り付けは文字だけ（他のアプリの書式は持ち込まない）
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onKeyUp={readState}
        onMouseUp={readState}
      />
      {/* 装飾のボタンは欄の下（文字を選んだときに出るコピー等のメニューと重ならないように） */}
      <div className={styles.toolbar} role="toolbar" aria-label="文字の装飾">
        <button type="button" onMouseDown={keep} onClick={() => exec("bold")} title="太字（Ctrl+B）" aria-label="太字" aria-pressed={on.b} data-on={on.b || undefined}>
          <b>B</b>
        </button>
        <button type="button" onMouseDown={keep} onClick={() => exec("italic")} title="斜体（Ctrl+I）" aria-label="斜体" aria-pressed={on.i} data-on={on.i || undefined}>
          <i>I</i>
        </button>
        <button type="button" onMouseDown={keep} onClick={() => exec("underline")} title="下線（Ctrl+U）" aria-label="下線" aria-pressed={on.u} data-on={on.u || undefined}>
          <u>U</u>
        </button>
        <span className={styles.sep} />
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => setPaletteOpen((o) => !o)}
          aria-expanded={paletteOpen}
          aria-label="文字色"
          title="文字色"
          className={styles.colorBtn}
        >
          <span>A</span>
          <span className={styles.colorBar} />
        </button>
        <button type="button" onMouseDown={keep} onClick={() => exec("removeFormat")} title="装飾を消す" aria-label="装飾を消す">
          ⌫
        </button>
        {props.maxLength && length > props.maxLength * 0.8 && (
          <span className={styles.count} data-over={length > props.maxLength || undefined}>
            {length}/{props.maxLength}
          </span>
        )}
      </div>
      {paletteOpen && (
        <div className={styles.palette} role="group" aria-label="文字色を選ぶ">
          {TEXT_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              className={styles.swatch}
              style={{ "--sw": c.color } as CSSProperties}
              onMouseDown={keep}
              onClick={() => applyColor(c.color)}
              title={c.label}
              aria-label={`文字色：${c.label}`}
              data-default={c.color === DEFAULT_TEXT_COLOR || undefined}
            />
          ))}
          {custom.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.swatch}
              style={{ "--sw": c } as CSSProperties}
              onMouseDown={keep}
              onClick={() => applyColor(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCustom((xs) => xs.filter((x) => x !== c));
              }}
              title={`${c}（右クリックで消す）`}
              aria-label={`自分で作った色 ${c}`}
              data-custom
            />
          ))}
          <label className={styles.addColor} title="自由な色を作って追加">
            ＋色を作る
            <input type="color" defaultValue="#c026d3" onChange={(e) => addCustom(e.target.value)} aria-label="自由な色を作る" />
          </label>
        </div>
      )}

    </div>
  );
}
