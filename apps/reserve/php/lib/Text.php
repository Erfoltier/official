<?php
declare(strict_types=1);

/**
 * 氏名などの文字列の扱い（Node.js 版 text.ts と同じ）。
 * 氏名の文字種は制限しない。禁止するのは表示を壊す制御文字だけ。
 */
const FORBIDDEN_CHARS = '/[\x{0000}-\x{001f}\x{007f}-\x{009f}\x{202a}-\x{202e}\x{2066}-\x{2069}]/u';

function normalize_nfc(string $s): string
{
    return class_exists('Normalizer') ? (Normalizer::normalize($s, Normalizer::FORM_C) ?: $s) : $s;
}

function clean_name(string $s): string
{
    return trim((string) preg_replace('/[\s\x{3000}]+/u', ' ', normalize_nfc($s)));
}

function has_forbidden_chars(string $s): bool
{
    return preg_match(FORBIDDEN_CHARS, $s) === 1;
}

/** 全角英数字・記号 → 半角、半角カナ → 全角（NFKC 相当） */
function normalize_width(string $s): string
{
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_KC);
        if ($n !== false) {
            return $n;
        }
    }
    return mb_convert_kana($s, 'asKV');
}

/**
 * 検索用の正規化：全角／半角、大文字／小文字、ひらがな／カタカナ、空白・中黒・ハイフン類の違いを無視
 */
function search_key(string $s): string
{
    $s = mb_strtolower(normalize_width($s));
    $s = mb_convert_kana($s, 'C'); // ひらがな → カタカナ
    return (string) preg_replace('/[\s・･\-‐_.]/u', '', $s);
}

function digits_only(?string $s): string
{
    return (string) preg_replace('/\D/', '', (string) $s);
}

/** 文字数（JavaScript の length と同じく UTF-16 の単位で数える） */
function js_length(string $s): int
{
    return intdiv(strlen((string) mb_convert_encoding($s, 'UTF-16LE', 'UTF-8')), 2);
}
