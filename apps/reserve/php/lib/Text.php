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

/**
 * 旧字体・異体字をよく使う字にそろえる（瀨→瀬、冨→富、髙→高、﨑→崎 など）。
 * 機器などに似た字で登録された氏名を照合するときだけ使う（Node.js 版 text.ts の foldNameVariants と同じ）
 */
const NAME_VARIANTS = ['瀨' => '瀬', '冨' => '富', '髙' => '高', '﨑' => '崎', '嵜' => '崎', '碕' => '崎', '邊' => '辺', '邉' => '辺', '齋' => '斎', '齊' => '斎', '斉' => '斎', '澤' => '沢', '濱' => '浜', '濵' => '浜', '嶋' => '島', '嶌' => '島', '廣' => '広', '國' => '国', '德' => '徳', '槇' => '槙', '栁' => '柳', '惠' => '恵', '眞' => '真', '實' => '実', '藏' => '蔵', '榮' => '栄', '櫻' => '桜', '龍' => '竜', '曾' => '曽', '增' => '増', '莊' => '荘', '條' => '条', '淺' => '浅', '黑' => '黒', '舘' => '館', '寬' => '寛', '渕' => '淵', '渊' => '淵', '檜' => '桧', '萬' => '万', '與' => '与', '壽' => '寿', '圓' => '円', '鐵' => '鉄', '會' => '会', '學' => '学', '戶' => '戸', '兒' => '児', '爲' => '為', '遙' => '遥', '晉' => '晋', '彌' => '弥', '禮' => '礼', '靜' => '静', '豐' => '豊', '傳' => '伝', '樂' => '楽', '來' => '来', '稻' => '稲', '縣' => '県', '關' => '関', '麥' => '麦', '峯' => '峰', '崗' => '岡', '桒' => '桑', '埜' => '野', '冝' => '宜', '恆' => '恒', '亞' => '亜', '穗' => '穂', '緖' => '緒', '臺' => '台', '橫' => '横', '黃' => '黄', '祐' => '祐', '隆' => '隆', '塚' => '塚', '𠮷' => '吉', '𡈽' => '土', '髮' => '髪', '驒' => '騨', '鄕' => '郷', '卷' => '巻', '劍' => '剣', '澁' => '渋', '迺' => '乃', '嶽' => '岳', '冱' => '冴', '蘆' => '芦', '蓮' => '蓮', '﨔' => '欅', '槗' => '橋', '桥' => '橋', '舩' => '船', '濟' => '済', '齒' => '歯', '邨' => '村', '嵩' => '嵩'];

function fold_name_variants(string $s): string
{
    return strtr($s, NAME_VARIANTS);
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
