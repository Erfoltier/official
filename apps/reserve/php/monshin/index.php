<?php
/**
 * 患者が入力する問診票（ログイン不要・送信のみ）。
 * 質問は 設定 → 問診票 で院長・管理者が決めたもの。回答の閲覧はここからはできない。
 * 本番では入口の鍵（Basic認証）の外に置く（別のサブドメインなど。php/README.md を参照）。
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
header_remove('X-Powered-By');

$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
$errors = [];
$general = '';
$post = [];

try {
    $form = Monshin::form();
    $clinic = Store::clinic();
} catch (Throwable $e) {
    http_response_code(503);
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font-family:sans-serif;padding:24px">ただいま問診票を受け付けられません。お手数ですが、お電話でお知らせください。</p>';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $post = $_POST;
    try {
        if (Http::crossSiteWrite()) {
            throw new StoreError('invalid', 'このページから送信してください');
        }
        $errors = Monshin::submit($post, (string) ($_SERVER['REMOTE_ADDR'] ?? ''));
        if (!$errors) {
            // 送信後は完了の画面へ（再読み込みで二重に送らないように。入力した内容は画面に残さない）
            header('Location: ?done=1', true, 303);
            exit;
        }
        $general = '入力内容をご確認ください。';
        http_response_code(400);
    } catch (StoreError $e) {
        $general = $e->getMessage();
        http_response_code($e->codeName === 'locked' ? 429 : 400);
    } catch (Throwable $e) {
        error_log('monshin: ' . get_class($e));
        $general = '送信できませんでした。お手数ですが、時間をおいてもう一度お試しください。';
        http_response_code(500);
    }
}

$done = ($_GET['done'] ?? '') === '1' && !$post;
$title = $form['title'] . '｜' . ($clinic['name'] ?? '');
$val = function (string $id) use ($post) {
    $v = $post['q_' . $id] ?? '';
    return is_string($v) ? $v : '';
};
$picked = function (string $id, string $opt) use ($post): bool {
    $v = $post['q_' . $id] ?? null;
    return is_array($v) ? in_array($opt, $v, true) : $v === $opt;
};
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title><?= $h($title) ?></title>
<style>
:root{--ink:#2b2a33;--sub:#6b6878;--line:#dcd8e6;--bg:#f7f5fb;--accent:#6b4fbb;--err:#c0392b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;line-height:1.7;font-size:16px}
main{max-width:640px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}
.clinic{color:var(--sub);font-size:14px;margin:0 0 16px}
.intro{white-space:pre-wrap;margin:0 0 20px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 12px}
label.q,legend.q{display:block;font-weight:600;margin:0 0 8px;padding:0}
fieldset{border:0;margin:0;padding:0;min-width:0}
.req{color:#fff;background:var(--err);font-size:11px;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:2px}
input[type=text],input[type=tel],input[type=email],input[type=date],textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff}
textarea{min-height:96px;resize:vertical}
.opt{display:flex;gap:8px;align-items:center;padding:6px 0}
.opt input{width:20px;height:20px;margin:0}
.msg{color:var(--err);font-size:14px;margin:6px 0 0}
.alert{background:#fdecea;color:var(--err);border-radius:8px;padding:12px;margin:0 0 16px}
button{width:100%;font:inherit;font-weight:700;color:#fff;background:var(--accent);border:0;border-radius:10px;padding:14px;margin-top:8px;cursor:pointer}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.done{white-space:pre-wrap}
</style>
</head>
<body>
<main>
<h1><?= $h($form['title']) ?></h1>
<p class="clinic"><?= $h($clinic['name'] ?? '') ?></p>
<?php if ($done): ?>
  <div class="card done"><?= $h($form['done']) ?></div>
<?php else: ?>
  <?php if ($form['intro'] !== ''): ?><p class="intro"><?= $h($form['intro']) ?></p><?php endif; ?>
  <?php if ($general !== ''): ?><div class="alert" role="alert"><?= $h($general) ?></div><?php endif; ?>
  <form method="post" action="" autocomplete="on" novalidate>
    <input type="hidden" name="stamp" value="<?= $h(Monshin::stamp()) ?>">
    <div class="hp" aria-hidden="true"><label>ホームページ<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <?php foreach ($form['questions'] as $x):
        $id = $x['id'];
        $name = 'q_' . $id;
        $req = $x['required'] ? '<span class="req">必須</span>' : '';
        $err = $errors[$id] ?? null;
        $ac = match (true) {
            (bool) preg_match('/フリガナ|ふりがな|カナ/u', $x['label']) => 'off',
            (bool) preg_match('/お名前|氏名|名前/u', $x['label']) => 'name',
            (bool) preg_match('/郵便番号|〒/u', $x['label']) => 'postal-code',
            (bool) preg_match('/住所/u', $x['label']) => 'street-address',
            $x['type'] === 'tel' => 'tel',
            $x['type'] === 'email' => 'email',
            $x['type'] === 'date' => 'bday',
            default => 'off',
        };
    ?>
    <div class="card">
      <?php if ($x['type'] === 'choice' || $x['type'] === 'multi'): ?>
        <fieldset>
          <legend class="q"><?= $h($x['label']) ?><?= $req ?></legend>
          <?php foreach ($x['options'] as $o): ?>
            <label class="opt"><input type="<?= $x['type'] === 'multi' ? 'checkbox' : 'radio' ?>" name="<?= $h($name) ?><?= $x['type'] === 'multi' ? '[]' : '' ?>" value="<?= $h($o) ?>"<?= $picked($id, $o) ? ' checked' : '' ?>><?= $h($o) ?></label>
          <?php endforeach; ?>
        </fieldset>
      <?php else: ?>
        <label class="q" for="<?= $h($name) ?>"><?= $h($x['label']) ?><?= $req ?></label>
        <?php if ($x['type'] === 'textarea'): ?>
          <textarea id="<?= $h($name) ?>" name="<?= $h($name) ?>" maxlength="2000"<?= $x['required'] ? ' required' : '' ?>><?= $h($val($id)) ?></textarea>
        <?php else: ?>
          <input id="<?= $h($name) ?>" name="<?= $h($name) ?>" type="<?= $h($x['type']) ?>" value="<?= $h($val($id)) ?>" maxlength="200" autocomplete="<?= $ac ?>"<?= $x['type'] === 'tel' ? ' inputmode="tel"' : '' ?><?= $x['required'] ? ' required' : '' ?>>
        <?php endif; ?>
      <?php endif; ?>
      <?php if ($err): ?><p class="msg"><?= $h($err) ?></p><?php endif; ?>
    </div>
    <?php endforeach; ?>
    <button type="submit">送信する</button>
  </form>
<?php endif; ?>
</main>
</body>
</html>
