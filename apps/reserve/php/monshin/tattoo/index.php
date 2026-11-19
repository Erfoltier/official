<?php
/**
 * 日曜の Web 予約ページ（公開）：タトゥー・アートメイク除去と、院が日曜の受付を許可したメニュー。院の LINE のメニューなどから開く。
 * 選べる時刻はサーバーが決める（TattooBooking::plan）。この画面には時刻の決め方の説明を出さない
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
// LINE の中で開いたとき（LIFF）の SDK と、LINE への確認の通信だけを許す
header("Content-Security-Policy: default-src 'none'; script-src 'self' https://static.line-scdn.net; connect-src 'self' https://*.line.me https://*.line-scdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.line-scdn.net; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
header_remove('X-Powered-By');

try {
    $p = Store::publicInfo();
    $open = TattooBooking::open();
    $tattooOn = TattooBooking::ready();
    $kindTattoo = TattooBooking::kindOn('tattoo');
    $kindArtmake = TattooBooking::kindOn('artmake');
    $items = TattooBooking::publicItems();
    $menus = TattooBooking::publicMenus();
    $liffId = TattooBooking::settings()['liffId'];
} catch (Throwable $e) {
    $p = ['publicName' => '', 'publicNameEn' => '', 'privacyUrl' => '', 'address' => '', 'accessUrl' => ''];
    $liffId = '';
    $open = $tattooOn = $kindTattoo = $kindArtmake = false;
    $items = [];
    $menus = [];
}
// メニューが多いときは、まず分類を選び、次にメニュー（院長 11/19）。並びは設定の順
$useCat = TattooBooking::useCategories($menus);
$cats = array_values(array_unique(array_column($menus, 'category')));
// タトゥー以外のメニューもあるときは「日曜日のご予約」
$pageTitle = $items !== [] ? '日曜日のご予約' : 'タトゥー・アートメイク除去のご予約';
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
$v = '20261119-3';
?>
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex">
  <title><?= $h($pageTitle) ?></title>
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
<?php if ($items !== []): ?>
      <p class="eyebrow">SUNDAY RESERVATION</p>
      <h1>日曜日のご予約</h1>
      <p>このページは<strong>日曜日の診療</strong>のご予約です。ほかの美容皮膚科の診療日（水曜・祝日）とは異なります。</p>
<?php else: ?>
      <p class="eyebrow">TATTOO / ART MAKE REMOVAL</p>
      <h1>タトゥー・アートメイク除去のご予約</h1>
      <p>タトゥー・アートメイク除去は<strong>日曜日の診療</strong>です。ほかの美容皮膚科の診療日（水曜・祝日）とは異なります。</p>
<?php endif; ?>
    </header>

<?php if (!$open): ?>
    <div class="notice" role="note"><strong>現在、日曜日のご予約は受け付けておりません。</strong></div>
<?php else: ?>
    <form id="tt-form" novalidate>
      <section class="card">
        <div class="section-heading">
          <span class="step">1</span>
          <div><h2>ご希望の内容</h2><p><?= $tattooOn ? '除去の場合は、照射する面積によってご予約いただける時間が変わります' : 'ご希望の施術を選んでください' ?></p></div>
        </div>
        <fieldset class="field">
          <legend><?= $items !== [] ? 'ご希望の施術' : '除去したいもの' ?> <em>必須</em></legend>
<?php if ($useCat): ?>
          <div class="choice-grid two tt-cats" id="cats">
<?php foreach ($cats as $c): ?>
            <label class="pill"><input type="radio" name="cat" value="<?= $h($c) ?>"><span><?= $h($c) ?></span></label>
<?php endforeach; ?>
          </div>
          <p class="field-note" id="cat-note">分類を選ぶと、施術が出ます</p>
<?php endif; ?>
          <div class="choice-grid two" id="kinds"<?= $useCat ? ' hidden' : '' ?>>
<?php foreach ($menus as $m): ?>
<?php if ($m['key'] === 'tattoo'): ?>
            <label class="pill" data-cat="<?= $h($m['category']) ?>"><input type="radio" name="kind" value="tattoo"><span>タトゥー・刺青<?= $items !== [] ? 'の除去' : '' ?></span></label>
<?php elseif ($m['key'] === 'artmake'): ?>
            <label class="pill" data-cat="<?= $h($m['category']) ?>"><input type="radio" name="kind" value="artmake"><span>アートメイク（眉）<?= $items !== [] ? 'の除去' : '' ?></span></label>
<?php else: $it = $m['item']; ?>
            <label class="pill" data-cat="<?= $h($m['category']) ?>"><input type="radio" name="kind" value="m:<?= $h($it['id']) ?>" data-first="<?= $it['first'] ? '1' : '' ?>" data-repeat="<?= $it['repeat'] ? '1' : '' ?>" data-note="<?= $h($it['note']) ?>" data-groups="<?= $h(json_encode($it['groups'], JSON_UNESCAPED_UNICODE)) ?>" data-count="<?= $it['count'] ? '1' : '' ?>" data-flow="<?= $it['flow'] ? '1' : '' ?>"><span><?= $h($it['name']) ?></span></label>
<?php endif; ?>
<?php endforeach; ?>
          </div>
          <p class="field-note" id="item-note" hidden></p>
        </fieldset>
        <fieldset class="field">
          <legend id="visit-legend">当院でのこの施術 <em>必須</em></legend>
          <div class="choice-grid two">
            <label class="pill" id="visit-first"><input type="radio" name="visit" value="first"><span>はじめて</span></label>
            <label class="pill" id="visit-repeat"><input type="radio" name="visit" value="repeat"><span>2回目以降</span></label>
          </div>
          <small class="field-note" id="visit-note">はじめての方は、照射の前にご説明（10分）があります</small>
        </fieldset>

        <div id="flow-box" hidden>
          <fieldset class="field">
            <legend>今回の治療内容 <em>必須</em></legend>
            <div class="choice-grid two">
<?php foreach (TattooBooking::STATUSES as $k => $label): ?>
              <label class="pill"><input type="radio" name="status" value="<?= $h($k) ?>"><span><?= $h($label) ?></span></label>
<?php endforeach; ?>
            </div>
          </fieldset>
          <fieldset class="field">
            <legend>麻酔 <em>必須</em></legend>
            <div class="choice-grid two">
<?php foreach (TattooBooking::ANESTHESIA as $k => $label): ?>
              <label class="pill"><input type="radio" name="anesthesiaType" value="<?= $h($k) ?>"><span><?= $h($label) ?></span></label>
<?php endforeach; ?>
            </div>
            <small class="field-note">院内の麻酔クリームの方は、麻酔のあと約45分お待ちいただいてから施術します（ご来院の時刻は麻酔の時刻です）</small>
          </fieldset>
        </div>
        <fieldset class="field" id="group-box" hidden>
          <legend>区分 <em>必須</em></legend>
          <div class="choice-grid two" id="group-list"></div>
        </fieldset>
        <fieldset class="field" id="parts-box" hidden>
          <legend>ご希望の部位 <em>必須</em>（いくつでも選べます）</legend>
          <div class="choice-grid two" id="parts-list"></div>
        </fieldset>
        <label class="field" id="count-box" hidden><span>本数 <em>必須</em></span><input name="count" type="number" inputmode="numeric" min="1" max="5000" step="1" placeholder="前回お伝えした本数（例：300）"><small class="field-note">本数によってご予約いただける時間が変わります。わからない場合は LINE でご相談ください</small></label>

        <div class="tt-area" id="area-box" hidden>
          <p class="tt-area-title">希望照射面積 <em>必須</em></p>
          <p class="field-note" id="area-help">タトゥーをすべて含めることのできる長方形を考え、その長い辺と短い辺をcmで入力してください。</p>
          <div class="tt-rect" data-rect="0">
            <span class="tt-rect-label" id="rect0-label">長方形</span>
            <label><input name="r0a" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="長い辺"><span>cm ×</span></label>
            <label><input name="r0b" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="短い辺"><span>cm</span></label>
          </div>
          <div class="tt-rect" data-rect="1" id="rect1" hidden>
            <span class="tt-rect-label">右眉</span>
            <label><input name="r1a" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="長い辺"><span>cm ×</span></label>
            <label><input name="r1b" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="短い辺"><span>cm</span></label>
          </div>
          <p class="tt-area-result" id="area-result" aria-live="polite"></p>
        </div>

        <fieldset class="field" id="color-box" hidden>
          <legend>インクの色（任意）</legend>
          <div class="choice-grid two">
            <label class="pill"><input type="radio" name="color" value="black"><span>黒のみ</span></label>
            <label class="pill"><input type="radio" name="color" value="color"><span>カラーあり</span></label>
          </div>
        </fieldset>
        <label class="field"><span>部位（任意）</span><input name="part" maxlength="60" placeholder="例：左腕・眉"></label>
        <fieldset class="field" id="anes-box">
          <legend>局所麻酔注射（任意）</legend>
          <div class="choice-grid two">
            <label class="pill"><input type="radio" name="anesthesia" value="no" checked><span>希望しない</span></label>
            <label class="pill"><input type="radio" name="anesthesia" value="yes"><span>希望する</span></label>
          </div>
          <small class="field-note">極細の針による麻酔注射です（1ccあたり5,500円・税込）</small>
        </fieldset>
      </section>

      <section class="card" id="date-card" hidden>
        <div class="section-heading">
          <span class="step">2</span>
          <div><h2>ご希望の日時</h2><p>選べる日をタップすると、ご予約いただける時刻が表示されます</p></div>
        </div>
        <div class="calendar-toolbar">
          <button type="button" class="icon-button" id="prev-month" aria-label="前の月">‹</button>
          <strong id="calendar-title"></strong>
          <button type="button" class="icon-button" id="next-month" aria-label="次の月">›</button>
        </div>
        <div class="calendar-weekdays" aria-hidden="true"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
        <div class="calendar-grid" id="calendar-grid" role="grid" aria-label="ご希望の日"></div>
        <p class="selected-date" id="selected-date">日付を選んでください</p>
        <div class="choice-grid four" id="times" role="radiogroup" aria-label="ご来院の時刻"></div>
        <p class="tt-empty" id="no-slots" hidden>ただいま、この内容でご予約いただける日時がありません。お手数ですが、LINE でご相談ください。</p>
      </section>

      <section class="card">
        <div class="section-heading">
          <span class="step">3</span>
          <div><h2>ご本人の情報</h2><p>ご予約の確認のため、正しくご入力ください</p></div>
        </div>
        <label class="field"><span>お名前 <em>必須</em></span><input name="name" autocomplete="name" maxlength="60" placeholder="例：山田 花子"></label>
        <label class="field"><span>フリガナ <em>必須</em></span><input name="kana" maxlength="60" placeholder="例：ヤマダ ハナコ"></label>
        <label class="field"><span>生年月日 <em>必須</em></span><input name="birthDate" type="date" min="1900-01-01"></label>
        <label class="field"><span>電話番号 <em>必須</em></span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="例：09012345678"></label>
        <p class="tt-line" id="line-note" hidden>LINE で開いていただいたので、ご予約確定のご連絡はこの LINE にお送りします。</p>
        <label class="field"><span id="email-label">メールアドレス <em>必須</em></span><input name="email" type="email" autocomplete="email" maxlength="200" placeholder="ご予約確定のメールをお送りします"></label>
        <label class="field"><span>LINEの表示名（任意）</span><input name="lineName" maxlength="60"></label>
        <label class="field"><span>ご相談・お伝えしたいこと（任意）</span><textarea name="notes" rows="3" maxlength="400"></textarea></label>
        <label class="tt-trap" aria-hidden="true">ウェブサイト<input name="website" tabindex="-1" autocomplete="off"></label>
<?php if ($p['privacyUrl'] !== ''): ?>
        <p class="field-note">ご入力の内容は、<a href="<?= $h($p['privacyUrl']) ?>" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>に沿って取り扱います。</p>
<?php endif; ?>
      </section>

      <section class="card tt-visit">
<?php if ($tattooOn): ?>
        <div class="shave-notice">
          <h2>ご来院前のお願い<?= $items !== [] ? '（タトゥー・アートメイク除去の方）' : '' ?></h2>
          <p><?= $h(TattooBooking::SHAVE_NOTICE_PAGE) ?></p>
        </div>
<?php endif; ?>
        <h2>日曜日のご来院について</h2>
<?php foreach (TattooBooking::VISIT_NOTICE as $line): ?>
        <p><?= $h($line) ?></p>
<?php endforeach; ?>
        <h2>キャンセル・日程変更にかかる料金規定</h2>
<?php foreach (TattooBooking::CANCEL_POLICY as $line): ?>
        <p><?= $h($line) ?></p>
<?php endforeach; ?>
      </section>

      <div class="error-summary" id="error-summary" role="alert" hidden></div>
      <button class="submit-button" type="submit" id="submit-button">この内容で予約する</button>
    </form>

    <section class="card centered" id="done" hidden>
      <div class="complete-mark">✓</div>
      <h2>ご予約を承りました</h2>
      <p id="done-when"></p>
      <p id="done-mail"></p>
      <div class="tt-visit">
        <div class="shave-notice"<?= $tattooOn ? '' : ' hidden' ?>>
          <h3>ご来院前のお願い</h3>
          <p id="done-before"><?= $tattooOn ? $h(TattooBooking::SHAVE_NOTICE_PAGE) : '' ?></p>
        </div>
        <h3>日曜日のご来院について</h3>
<?php foreach (TattooBooking::VISIT_NOTICE as $line): ?>
        <p><?= $h($line) ?></p>
<?php endforeach; ?>
        <h3>キャンセル・日程変更にかかる料金規定</h3>
<?php foreach (TattooBooking::CANCEL_POLICY as $line): ?>
        <p><?= $h($line) ?></p>
<?php endforeach; ?>
      </div>
<?php if (($p['accessUrl'] ?? '') !== ''): ?>
      <p>アクセス：<a href="<?= $h($p['accessUrl']) ?>" target="_blank" rel="noopener noreferrer"><?= $h($p['accessUrl']) ?></a></p>
<?php elseif (($p['address'] ?? '') !== ''): ?>
      <p>場所：<?= $h($p['address']) ?></p>
<?php endif; ?>
    </section>
<?php if ($liffId !== ''): ?>
    <script src="https://static.line-scdn.net/liff/edge/2/sdk.js" charset="utf-8"></script>
<?php endif; ?>
    <script type="module" src="./app.js?v=<?= $v ?>" data-liff="<?= $h($liffId) ?>"></script>
<?php endif; ?>
  </main>
</body>
</html>
