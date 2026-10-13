<?php
/**
 * 患者が自分で入力する問診票（Googleフォームの代わり）。
 * - 質問の並びは設定（meta: monshinForm）。院長・管理者が設定 → 問診票 で直す
 * - 送られた回答は、Googleフォームからの取り込みと同じ流れ（Store::receiveQuestionnaires）で保存・患者に結びつけ・空欄を埋める
 * - 患者は送るだけ。回答を見る口はない
 * - いたずら対策：同じ送り元からの回数制限、ボットよけの隠し欄、開いてすぐ／古すぎるページからの送信を断る（外部サービスは使わない）
 */
declare(strict_types=1);

final class Monshin
{
    public const TYPES = ['text', 'textarea', 'date', 'tel', 'email', 'choice', 'multi'];
    /** 同じ送り元：1時間に5件・1日に20件まで。全体でも1時間に200件まで（大量のいたずらで DB が埋まらないように） */
    private const IP_PER_HOUR = 5;
    private const IP_PER_DAY = 20;
    private const ALL_PER_HOUR = 200;
    /** ページを開いてから送るまで：3秒未満はボットとみなす。1日を過ぎたページは開き直してもらう */
    private const MIN_FILL_MS = 3000;
    private const MAX_FILL_MS = 86_400_000;

    /** questionnaire.gs の COLUMNS と同じ見分け方（Store 側の取り込みと合わせる） */
    private const ROLES = [
        'name' => '/^(?!.*(フリガナ|ふりがな|カナ)).*(お名前|氏名|名前)/u',
        'kana' => '/フリガナ|ふりがな|カナ/u',
        'birthDate' => '/生年月日/u',
        'phone' => '/電話/u',
        'history' => '/既往|病歴|治療中の病気|かかっている病気/u',
        'medications' => '/内服|服用|飲んでいる薬|お薬/u',
        'allergies' => '/アレルギー/u',
    ];

    public static function defaults(): array
    {
        $q = fn(string $label, string $type, bool $required = false, array $options = []) => ['label' => $label, 'type' => $type, 'required' => $required, 'options' => $options];
        return [
            'title' => '問診票',
            'intro' => 'ご来院前にご記入ください。ご記入いただいた内容は診療のためだけに使います。',
            'done' => '送信しました。ご記入ありがとうございました。ご来院をお待ちしております。',
            'questions' => self::withIds([
                $q('お名前', 'text', true),
                $q('フリガナ', 'text', true),
                $q('生年月日', 'date', true),
                $q('性別', 'choice', false, ['女性', '男性', '回答しない']),
                $q('電話番号', 'tel', true),
                $q('メールアドレス', 'email'),
                $q('郵便番号', 'text'),
                $q('ご住所', 'text'),
                $q('現在治療中の病気・既往歴', 'textarea'),
                $q('現在服用している内服薬', 'textarea'),
                $q('アレルギー', 'textarea'),
                $q('その他のご相談事項', 'textarea'),
            ]),
        ];
    }

    /** 最初の並びの質問には決まった id を付ける（保存前でも、開いたページと送信で id が同じになるように） */
    private static function withIds(array $qs): array
    {
        return array_map(fn($x, $i) => ['id' => 'd' . ($i + 1), ...$x], $qs, array_keys($qs));
    }

    public static function form(): array
    {
        Store::init();
        return Db::i()->meta('monshinForm') ?? self::defaults();
    }

    /** 質問の並びを保存する（院長・管理者） */
    public static function saveForm(array $in, array $actor): array
    {
        Store::init();
        $line = fn($v, int $max) => js_slice(js_trim((string) preg_replace('/[\x00-\x1f\x7f]/u', ' ', (string) $v)), $max);
        $block = fn($v, int $max) => js_slice(js_trim((string) preg_replace('/[\x00-\x09\x0b-\x1f\x7f]/u', '', str_replace("\r\n", "\n", (string) $v))), $max);
        $qs = [];
        $seen = [];
        foreach ($in['questions'] as $x) {
            $label = $line($x['label'] ?? '', 200);
            if ($label === '') {
                throw new StoreError('invalid', '質問の文が空の欄があります');
            }
            if (isset($seen[$label])) {
                throw new StoreError('invalid', "同じ質問が2つあります：{$label}");
            }
            $seen[$label] = true;
            $type = in_array($x['type'] ?? '', self::TYPES, true) ? $x['type'] : 'text';
            $options = [];
            if ($type === 'choice' || $type === 'multi') {
                foreach ((array) ($x['options'] ?? []) as $o) {
                    $o = $line($o, 100);
                    if ($o !== '' && !in_array($o, $options, true)) {
                        $options[] = $o;
                    }
                }
                if (!$options) {
                    throw new StoreError('invalid', "「{$label}」の選択肢を入れてください");
                }
            }
            $id = preg_match('/^[A-Za-z0-9_-]{1,40}$/', (string) ($x['id'] ?? '')) ? $x['id'] : 'q' . bin2hex(random_bytes(4));
            $qs[] = ['id' => $id, 'label' => $label, 'type' => $type, 'required' => !empty($x['required']), 'options' => array_slice($options, 0, 30)];
        }
        if (count($qs) > 80) {
            throw new StoreError('invalid', '質問は80個までです');
        }
        $name = self::findRole($qs, 'name');
        if ($name === null || !$name['required']) {
            throw new StoreError('invalid', '「お名前」の質問（必須）を入れてください。患者に結びつけるのに使います');
        }
        $form = [
            'title' => $line($in['title'] ?? '', 60) ?: '問診票',
            'intro' => $block($in['intro'] ?? '', 1000),
            'done' => $block($in['done'] ?? '', 500) ?: '送信しました。ご記入ありがとうございました。',
            'questions' => $qs,
        ];
        Db::i()->setMeta('monshinForm', $form);
        Auth::audit($actor, '問診票の質問を変更');
        return $form;
    }

    public static function findRole(array $qs, string $role): ?array
    {
        foreach ($qs as $x) {
            if (preg_match(self::ROLES[$role], $x['label'])) {
                return $x;
            }
        }
        return null;
    }

    /**
     * これまでに取り込んだ問診票の「質問の見出し」だけを集める（回答の中身は読まない）。
     * 見出しは、よく出てくる順ではなく、回答の中で並んでいた順（平均の位置）に並べる
     */
    public static function pastHeadings(): array
    {
        Store::init();
        $pos = [];
        foreach (Db::i()->all('questionnaire') as $q) {
            if (!empty($q['deleted'])) {
                continue;
            }
            foreach (array_values($q['answers'] ?? []) as $i => $a) {
                $h = (string) ($a['q'] ?? '');
                if ($h === '' || preg_match('/タイムスタンプ|timestamp|回答日時/iu', $h)) {
                    continue;
                }
                $pos[$h] ??= ['sum' => 0, 'n' => 0];
                $pos[$h]['sum'] += $i;
                $pos[$h]['n']++;
            }
        }
        uksort($pos, fn($a, $b) => ($pos[$a]['sum'] / $pos[$a]['n']) <=> ($pos[$b]['sum'] / $pos[$b]['n']));
        $out = [];
        foreach ($pos as $h => $p) {
            $out[] = ['label' => $h, 'count' => $p['n'], 'type' => self::guessType($h)];
        }
        return $out;
    }

    /** 見出しの言葉から入力欄の形を推し量る（選択肢は回答を見ないので、院で入れてもらう） */
    public static function guessType(string $h): string
    {
        return match (true) {
            (bool) preg_match('/生年月日/u', $h) => 'date',
            (bool) preg_match('/電話/u', $h) => 'tel',
            (bool) preg_match('/メール|e-?mail/iu', $h) => 'email',
            (bool) preg_match('/既往|病歴|病気|内服|服用|薬|アレルギー|相談|ご要望|その他|症状|お悩み/u', $h) => 'textarea',
            default => 'text',
        };
    }

    // ---- 患者からの送信 ----

    /** ページに埋める「開いた時刻＋署名」。送られてきたときに、開いてからの時間を確かめる */
    public static function stamp(?int $now = null): string
    {
        $now ??= (int) floor(microtime(true) * 1000);
        return $now . '.' . substr(hash_hmac('sha256', 'monshin:' . $now, (string) config()['session_secret']), 0, 32);
    }

    private static function checkStamp(string $stamp, int $now): void
    {
        [$t, $sig] = array_pad(explode('.', $stamp, 2), 2, '');
        if (!ctype_digit($t) || !hash_equals(substr(hash_hmac('sha256', 'monshin:' . $t, (string) config()['session_secret']), 0, 32), $sig)) {
            throw new StoreError('invalid', 'ページを開き直してから、もう一度送信してください');
        }
        $age = $now - (int) $t;
        if ($age < self::MIN_FILL_MS) {
            throw new StoreError('invalid', '少し時間をおいてから、もう一度送信してください');
        }
        if ($age > self::MAX_FILL_MS) {
            throw new StoreError('invalid', 'ページを開いてから時間がたちました。お手数ですが、ページを開き直してもう一度ご記入ください');
        }
    }

    /** 回数制限。数えるのは送り元の IP の要約（そのままの IP は残さない） */
    public static function checkRate(string $ip, int $now): void
    {
        $id = hash('sha256', 'monshin:' . $ip);
        $rec = Db::i()->get('monshinIp', $id) ?? ['at' => []];
        $day = array_values(array_filter($rec['at'], fn($t) => $t > $now - 86_400_000));
        $hour = array_filter($day, fn($t) => $t > $now - 3_600_000);
        $all = array_values(array_filter(Db::i()->get('monshinIp', '*')['at'] ?? [], fn($t) => $t > $now - 3_600_000));
        if (count($hour) >= self::IP_PER_HOUR || count($day) >= self::IP_PER_DAY || count($all) >= self::ALL_PER_HOUR) {
            throw new StoreError('locked', '送信が続いたため、しばらく受け付けられません。お手数ですが、時間をおいて送信いただくか、お電話でお知らせください');
        }
        $day[] = $now;
        $all[] = $now;
        Db::i()->put('monshinIp', $id, ['at' => $day]);
        Db::i()->put('monshinIp', '*', ['at' => $all]);
    }

    /**
     * 患者の送信を受け取る。$post はフォームの値（q_<id> → 文字列か文字列の配列）。
     * 入力の誤りは [ 質問id => 文 ] で返す（保存しない）。うまくいけば []。
     * ボットよけの隠し欄が埋まっていたら、保存せずに成功したように見せる
     */
    public static function submit(array $post, string $ip, ?int $now = null): array
    {
        Store::init();
        $now ??= (int) floor(microtime(true) * 1000);
        if (trim((string) ($post['website'] ?? '')) !== '') {
            return [];
        }
        self::checkStamp((string) ($post['stamp'] ?? ''), $now);
        $form = self::form();
        [$errors, $answers, $values] = self::validate($form['questions'], $post);
        if ($errors) {
            return $errors;
        }
        $get = function (string $role) use ($form, $values): string {
            $x = self::findRole($form['questions'], $role);
            return $x ? ($values[$x['id']] ?? '') : '';
        };
        $r = [
            'key' => 'web-' . bin2hex(random_bytes(16)),
            'submittedAt' => date('Y/m/d H:i:s', intdiv($now, 1000)),
            'name' => $get('name'),
            'answers' => $answers,
        ];
        foreach (['kana', 'phone', 'history', 'medications', 'allergies'] as $k) {
            if (($v = $get($k)) !== '') {
                $r[$k] = $v;
            }
        }
        if (($b = $get('birthDate')) !== '') {
            $r['birthDate'] = str_replace('/', '-', $b);
        }
        Db::i()->transaction(function () use ($ip, $now, $r) {
            self::checkRate($ip, $now);
            Store::receiveQuestionnaires([$r]);
        });
        return [];
    }

    /**
     * フォームの値を質問どおりに確かめる。$skip の質問（LINE で本人確認済みの氏名など）は見ない。
     * 戻り値：[誤り（質問id => 文）, 回答（[q, a] の並び）, 値（質問id => 値）]
     */
    public static function validate(array $questions, array $post, array $skip = []): array
    {
        $errors = [];
        $answers = [];
        $values = [];
        foreach ($questions as $x) {
            if (isset($skip[$x['id']])) {
                continue;
            }
            $raw = $post['q_' . $x['id']] ?? '';
            if ($x['type'] === 'multi') {
                $picked = array_values(array_filter((array) $raw, fn($v) => is_string($v) && in_array($v, $x['options'], true)));
                $v = implode('、', $picked);
            } else {
                $v = is_string($raw) ? str_replace("\r\n", "\n", $raw) : '';
                $v = (string) preg_replace('/[\x00-\x09\x0b-\x1f\x7f]/u', '', mb_check_encoding($v, 'UTF-8') ? $v : '');
                $v = js_trim($x['type'] === 'textarea' ? $v : str_replace("\n", ' ', $v));
            }
            if ($v === '') {
                if ($x['required']) {
                    $errors[$x['id']] = '入力してください';
                }
                continue;
            }
            $max = $x['type'] === 'textarea' ? 2000 : 200;
            if (js_length($v) > $max) {
                $errors[$x['id']] = "{$max}文字以内で入力してください";
                continue;
            }
            $bad = match ($x['type']) {
                'date' => !is_date_string($v) ? '日付を選んでください' : null,
                'tel' => !preg_match('/^[0-9０-９\-－ー‐()（）+＋\s]{10,20}$/u', $v) || strlen(digits_only(normalize_width($v))) < 10 ? '電話番号を数字で入力してください（例：09012345678）' : null,
                'email' => !filter_var(normalize_width($v), FILTER_VALIDATE_EMAIL) ? 'メールアドレスの形が正しくありません' : null,
                'choice' => !in_array($v, $x['options'], true) ? '選択肢から選んでください' : null,
                default => null,
            };
            if ($bad !== null) {
                $errors[$x['id']] = $bad;
                continue;
            }
            if ($x['type'] === 'date') {
                $v = str_replace('-', '/', $v);
            }
            $values[$x['id']] = $v;
            $answers[] = ['q' => $x['label'], 'a' => $v];
        }
        return [$errors, $answers, $values];
    }

    // ---- CSV の書き出し（院長・管理者） ----

    /**
     * 期間（送信日、両端を含む）の問診票を CSV の文字列にする。サーバーにはファイルを残さない。
     * 列：送信日時・結びついた患者の診察券番号・患者名、続けて質問の見出し（出てきた順）
     */
    public static function exportCsv(string $from, string $to, array $actor): string
    {
        Store::init();
        if (!is_date_string($from) || !is_date_string($to) || $from > $to) {
            throw new StoreError('invalid', '期間を正しく選んでください');
        }
        $rows = [];
        $heads = [];
        $patients = Db::i()->all('patient');
        foreach (Db::i()->all('questionnaire') as $q) {
            if (!empty($q['deleted'])) {
                continue;
            }
            $day = str_replace('/', '-', js_slice((string) ($q['submittedAt'] ?? ''), 10));
            if (!preg_match('/^\d{4}-\d{1,2}-\d{1,2}$/', $day)) {
                $day = js_slice((string) ($q['receivedAt'] ?? ''), 10);
            }
            [$y, $m, $d] = array_map('intval', explode('-', $day) + [0, 0, 0]);
            $day = sprintf('%04d-%02d-%02d', $y, $m, $d);
            if ($day < $from || $day > $to) {
                continue;
            }
            foreach ($q['answers'] ?? [] as $a) {
                $heads[$a['q']] = true;
            }
            $rows[] = $q;
        }
        usort($rows, fn($a, $b) => strcmp((string) $a['receivedAt'], (string) $b['receivedAt']));
        $heads = array_keys($heads);
        $cell = function (string $v): string {
            // 表計算ソフトで式として読まれないように（=+-@ で始まる値の前に ' を付ける）
            if ($v !== '' && str_contains('=+-@', $v[0])) {
                $v = "'" . $v;
            }
            return '"' . str_replace('"', '""', $v) . '"';
        };
        $lines = [implode(',', array_map($cell, ['送信日時', '診察券番号', '結びついた患者', ...$heads]))];
        foreach ($rows as $q) {
            $p = !empty($q['patientId']) ? ($patients[$q['patientId']] ?? null) : null;
            $byQ = [];
            foreach ($q['answers'] ?? [] as $a) {
                $byQ[$a['q']] = $a['a'];
            }
            $lines[] = implode(',', array_map($cell, [
                (string) ($q['submittedAt'] ?? ''),
                (string) ($p['chartNo'] ?? ''),
                $p ? (string) $p['name'] : '（未確認）',
                ...array_map(fn($h) => (string) ($byQ[$h] ?? ''), $heads),
            ]));
        }
        Auth::audit($actor, '問診票の回答をCSVで書き出し', "{$from}〜{$to}・" . count($rows) . '件');
        return "\u{FEFF}" . implode("\r\n", $lines) . "\r\n";
    }
}
