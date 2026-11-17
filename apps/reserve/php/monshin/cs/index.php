<?php
/**
 * オンラインカウンセリング（ゼオスキン）の Web 予約ページ（公開）。LINE ではなく普通の Web ページ。
 * シミクレールのサイトに埋め込めるよう、frame-ancestors で許したサイトからだけ iframe を許す。
 * お客様向けの文言では「医師」「診察」「患者」を使わない
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

$ancestors = implode(' ', OnlineCs::FRAME_ANCESTORS);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self' {$ancestors}; base-uri 'none'; form-action 'none'");
header_remove('X-Powered-By');

try {
    $p = Store::publicInfo();
    $open = OnlineCs::settings()['enabled'];
} catch (Throwable $e) {
    $p = ['publicName' => '', 'publicNameEn' => '', 'privacyUrl' => ''];
    $open = false;
}
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
$v = '20261117-1';
?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex">
  <title>オンラインカウンセリングのご予約</title>
  <link rel="stylesheet" href="../intake/styles.css?v=<?= $v ?>">
  <link rel="stylesheet" href="./styles.css?v=<?= $v ?>">
</head>
<body>
  <main class="shell">
    <header class="clinic-header">
      <div class="clinic-logo">
        <img src="../intake/assets/clinic-mark.png" alt="">
        <span><b><?= $h($p['publicName']) ?></b><small><?= $h($p['publicNameEn']) ?></small></span>
      </div>
      <p class="eyebrow">ONLINE COUNSELING</p>
      <h1>オンラインカウンセリングのご予約</h1>
      <p>ゼオスキンについてのご相談です。ご都合のよい日時をお選びください（1枠15分）</p>
    </header>

<?php if (!$open): ?>
    <div class="notice" role="note"><strong>現在、オンラインカウンセリングのご予約は受け付けておりません。</strong></div>
<?php else: ?>
    <form id="cs-form" novalidate>
      <section class="card">
        <div class="section-heading">
          <span class="step">1</span>
          <div><h2>ご希望の日時</h2><p>選べる日をタップすると、空いている時間が表示されます</p></div>
        </div>
        <div class="calendar-toolbar">
          <button type="button" class="icon-button" id="prev-month" aria-label="前の月">‹</button>
          <strong id="calendar-title"></strong>
          <button type="button" class="icon-button" id="next-month" aria-label="次の月">›</button>
        </div>
        <div class="calendar-weekdays" aria-hidden="true"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
        <div class="calendar-grid" id="calendar-grid" role="grid" aria-label="ご希望の日"></div>
        <p class="selected-date" id="selected-date">日付を選んでください</p>
        <div class="choice-grid four" id="times" role="radiogroup" aria-label="ご希望の時間"></div>
        <p class="cs-empty" id="no-slots" hidden>ただいま、ご予約いただける日時がありません。</p>
      </section>

      <section class="card">
        <div class="section-heading">
          <span class="step">2</span>
          <div><h2>お客さま情報</h2><p>ご予約の確認のため、正しくご入力ください</p></div>
        </div>
        <label class="field"><span>お名前 <em>必須</em></span><input name="name" autocomplete="name" maxlength="60" placeholder="例：山田 花子"></label>
        <label class="field"><span>フリガナ <em>必須</em></span><input name="kana" maxlength="60" placeholder="例：ヤマダ ハナコ"></label>
        <label class="field"><span>生年月日 <em>必須</em></span><input name="birthDate" type="date" min="1900-01-01"></label>
        <label class="field"><span>電話番号 <em>必須</em></span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="例：09012345678"></label>
        <label class="field"><span>メールアドレス <em>必須</em></span><input name="email" type="email" autocomplete="email" maxlength="200" placeholder="ご予約確定のメールをお送りします"></label>
        <label class="field"><span>LINEの表示名（任意）</span><input name="lineName" maxlength="60"></label>
        <label class="field"><span>シミクレールの注文番号（任意）</span><input name="orderNo" maxlength="40" placeholder="例：#1001"><small class="field-note">カウンセリング前のご購入、またはオンラインカウンセリングをご購入済みの方はご入力ください</small></label>
        <label class="cs-trap" aria-hidden="true">ウェブサイト<input name="website" tabindex="-1" autocomplete="off"></label>
        <div class="joint-use">
          <p><b>個人情報の共同利用について</b></p>
          <p>カウンセリングのご予約と実施、ご注文内容の確認のため、ご入力いただいた個人情報を、いしだ皮フ科・美容皮膚科と株式会社エアフォルティアコンサルティング（シミクレール運営）で共同して利用します。</p>
          <ul>
            <li>共同して利用する項目：お名前・フリガナ・生年月日・電話番号・メールアドレス・LINEの表示名・注文番号・ご予約の日時と内容</li>
            <li>共同して利用する者：いしだ皮フ科・美容皮膚科、株式会社エアフォルティアコンサルティング</li>
            <li>利用の目的：カウンセリングのご予約・実施・ご連絡、ご注文内容の確認</li>
            <li>管理について責任を持つ者：いしだ皮フ科・美容皮膚科</li>
          </ul>
<?php if ($p['privacyUrl'] !== ''): ?>
          <p><a href="<?= $h($p['privacyUrl']) ?>" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a></p>
<?php endif; ?>
        </div>
        <label class="consent-choice"><input type="checkbox" name="jointUseConsent" value="agreed"><span>上記の個人情報の共同利用に同意します</span></label>
      </section>

      <div class="error-summary" id="error-summary" role="alert" hidden></div>
      <button class="submit-button" type="submit" id="submit-button">この内容で予約する</button>
    </form>

    <section class="card centered" id="done" hidden>
      <div class="complete-mark">✓</div>
      <h2>ご予約を承りました</h2>
      <p id="done-when"></p>
      <p id="done-mail"></p>
    </section>
    <script type="module" src="./app.js?v=<?= $v ?>"></script>
<?php endif; ?>
  </main>
</body>
</html>
