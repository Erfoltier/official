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

$preview = false;
try {
    $p = Store::publicInfo();
    // 設定画面のプレビュー：受け付けがオフでも開く（?all=1 ならオフのメニューも）。予約は送れない
    $preview = TattooBooking::previewValid((string) ($_GET['preview'] ?? ''));
    $s = $preview ? TattooBooking::previewSettings(($_GET['all'] ?? '') === '1') : TattooBooking::settings();
    $open = TattooBooking::open($s);
    $tattooOn = TattooBooking::ready($s);
    $kindTattoo = TattooBooking::kindOn('tattoo', $s);
    $kindArtmake = TattooBooking::kindOn('artmake', $s);
    $items = TattooBooking::publicItems($s);
    $menus = TattooBooking::publicMenus($s);
    $liffId = TattooBooking::settings()['liffId'];
    // 友だち追加のアドレス（LINE で開く設定のときだけ）
    $friendUrl = $liffId !== '' ? Reminder::friendUrl() : '';
} catch (Throwable $e) {
    $p = ['publicName' => '', 'publicNameEn' => '', 'privacyUrl' => '', 'address' => '', 'accessUrl' => ''];
    $liffId = '';
    $friendUrl = '';
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
$v = '20261128-1';
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
      <p>このページは<strong>日曜日の診療</strong>のご予約です。ほかの美容皮膚科の診療日（水曜・祝日）とは異なり、<strong>メニューを限定</strong>しています。ご予約いただけるのは、下に表示しているメニューのみです。</p>
<?php else: ?>
      <p class="eyebrow">TATTOO / ART MAKE REMOVAL</p>
      <h1>タトゥー・アートメイク除去のご予約</h1>
      <p>タトゥー・アートメイク除去は<strong>日曜日の診療</strong>です。ほかの美容皮膚科の診療日（水曜・祝日）とは異なります。</p>
<?php endif; ?>
    </header>

<?php if (!$open): ?>
    <div class="notice" role="note"><strong>現在、日曜日のご予約は受け付けておりません。</strong></div>
<?php else: ?>
<?php if ($preview): ?>
    <div class="notice tt-preview" role="note"><strong>プレビュー（院のスタッフ用）</strong><span>患者さんに見える画面です。ここからは予約できません。<?= ($_GET['all'] ?? '') === '1' ? 'オフのメニューも出しています。' : 'オンのメニューだけを出しています。' ?>日時は、受付日時と今の空きのとおりに出ます。</span></div>
<?php endif; ?>
<?php if ($liffId !== '' && !$preview): ?>
    <section class="card tt-gate" id="line-gate" hidden>
      <h2 id="gate-title">LINE の友だち追加をお願いします</h2>
      <p id="gate-text">ご予約確定のご連絡や、ご予約の変更・キャンセルを LINE で行うため、当院の LINE 公式アカウントの友だち追加が必要です。</p>
      <a class="submit-button" id="gate-add" href="<?= $h($friendUrl) ?>"<?= $friendUrl === '' ? ' hidden' : '' ?>>友だち追加する</a>
      <a class="submit-button" id="gate-open" href="https://liff.line.me/<?= $h($liffId) ?>" hidden>LINE で開く</a>
      <button type="button" class="tt-gate-again" id="gate-again" hidden>友だち追加しました</button>
      <small class="field-note" id="gate-note">友だち追加が済むと、そのままご予約の画面に進みます。</small>
    </section>
<?php endif; ?>
    <form id="tt-form" novalidate<?= $preview ? ' data-preview="1"' : '' ?><?= $liffId !== '' && !$preview ? ' data-gate="1" hidden' : '' ?>>
      <section class="card">
        <div class="section-heading">
          <span class="step">1</span>
          <div><h2>ご希望の内容</h2><p>ご希望の内容の量と範囲によって押さえる枠の時間が異なるため、ご案内できる時刻も変わることがあります。</p></div>
        </div>
        <!-- 当院の美容皮膚科の初診・再診（水曜・祝日の LINE 予約申請フォームと同じ問い。院長 11/19）。予約の時間はここから決める -->
        <fieldset class="field">
          <legend>当院の美容皮膚科の受診 <em>必須</em></legend>
          <div class="choice-grid two tt-two">
            <label class="pill"><input type="radio" name="clinicVisit" value="initial"><span>初診<small class="tt-pill-sub">美容皮膚科がはじめて</small></span></label>
            <label class="pill"><input type="radio" name="clinicVisit" value="returning"><span>再診<small class="tt-pill-sub">受診したことがある</small></span></label>
          </div>
        </fieldset>
        <div id="initial-box" hidden>
          <fieldset class="field">
            <legend>当院の保険通院歴 <em>必須</em></legend>
            <div class="choice-grid two tt-two">
              <label class="pill"><input type="radio" name="insuranceHistory" value="有"><span>有</span></label>
              <label class="pill"><input type="radio" name="insuranceHistory" value="無"><span>無</span></label>
            </div>
          </fieldset>
          <label class="field"><span>紹介者名（任意）</span><input name="referrer" maxlength="60" placeholder="紹介者がいる場合のみ"></label>
        </div>

        <div id="entries"></div>
        <template id="entry-tpl">
          <div class="tt-entry">
        <fieldset class="field">
          <legend><span data-r="entry-title"><?= $items !== [] ? 'ご希望の施術' : '除去したいもの' ?></span> <em>必須</em><button type="button" class="tt-entry-remove" data-r="remove" hidden>この施術を削除</button></legend>
<?php if ($useCat): ?>
          <div class="choice-grid two tt-cats" data-r="cats">
<?php foreach ($cats as $c): ?>
            <label class="pill"><input type="radio" name="cat" value="<?= $h($c) ?>"><span><?= $h($c) ?></span></label>
<?php endforeach; ?>
          </div>
          <p class="field-note" data-r="cat-note">分類を選ぶと、施術が出ます</p>
<?php endif; ?>
<?php if ($useCat): ?>
          <div class="tt-sub" data-r="sub" hidden>
            <p class="tt-sub-title" data-r="sub-title"></p>
<?php endif; ?>
          <div class="<?= $useCat ? 'tt-sub-list' : 'choice-grid two' ?>" data-r="kinds">
<?php foreach ($menus as $m): ?>
<?php if ($m['key'] === 'tattoo'): ?>
            <label class="pill" data-cat="<?= $h($m['category']) ?>"><input type="radio" name="kind" value="tattoo"><span>タトゥー・刺青<?= $items !== [] ? 'の除去' : '' ?></span></label>
<?php elseif ($m['key'] === 'artmake'): ?>
            <label class="pill" data-cat="<?= $h($m['category']) ?>"><input type="radio" name="kind" value="artmake"><span>アートメイク（眉）<?= $items !== [] ? 'の除去' : '' ?></span></label>
<?php else: $it = $m['item']; ?>
            <label class="pill" data-cat="<?= $h($m['category']) ?>"><input type="radio" name="kind" value="m:<?= $h($it['id']) ?>" data-first="<?= $it['first'] ? '1' : '' ?>" data-repeat="<?= $it['repeat'] ? '1' : '' ?>" data-note="<?= $h($it['note']) ?>" data-groups="<?= $h(json_encode($it['groups'], JSON_UNESCAPED_UNICODE)) ?>" data-count="<?= $it['count'] ? '1' : '' ?>" data-one="<?= $it['one'] ? '1' : '' ?>" data-pick-label="<?= $h($it['pickLabel']) ?>" data-flow="<?= $it['flow'] ? '1' : '' ?>" data-noinj="<?= $it['noInjection'] ? '1' : '' ?>" data-needle="<?= $it['needle'] ? '1' : '' ?>" data-cream="<?= $it['creamAsk'] ? '1' : '' ?>"><span><?= $h($it['name']) ?></span></label>
<?php endif; ?>
<?php endforeach; ?>
          </div>
<?php if ($useCat): ?>
          </div>
<?php endif; ?>
          <p class="field-note" data-r="item-note" hidden></p>
        </fieldset>
        <fieldset class="field" data-r="sameday-box">
          <legend>この施術の当日施術のご希望 <em>必須</em></legend>
          <div class="choice-grid two tt-two">
            <label class="pill"><input type="radio" name="sameDay" value="有"><span>有</span></label>
            <label class="pill"><input type="radio" name="sameDay" value="無"><span>無（ご相談のみ）</span></label>
          </div>
        </fieldset>
        <fieldset class="field" data-r="status-box" hidden>
          <legend>この施術の今回の治療内容 <em>必須</em></legend>
          <div class="choice-stack">
<?php foreach (TattooBooking::STATUSES as $k => $label): ?>
            <label class="row-choice"><input type="radio" name="status" value="<?= $h($k) ?>"><span><?= $h($label) ?></span></label>
<?php endforeach; ?>
          </div>
        </fieldset>
        <small class="field-note" data-r="visit-note" hidden></small>
        <div data-r="options">
        <div data-r="flow-box" hidden>
          <fieldset class="field">
            <legend>麻酔 <em>必須</em></legend>
            <div class="choice-grid two">
<?php foreach (TattooBooking::ANESTHESIA as $k => $label): ?>
              <label class="pill" data-r="anes-<?= $h($k) ?>"><input type="radio" name="anesthesiaType" value="<?= $h($k) ?>"><span><?= $h($label) ?></span></label>
<?php endforeach; ?>
            </div>
            <small class="field-note">院内の麻酔クリームの方は、麻酔のあと約45分お待ちいただいてから施術します（ご来院の時刻は麻酔の時刻です）</small>
          </fieldset>
        </div>
        <fieldset class="field" data-r="group-box" hidden>
          <legend>区分 <em>必須</em></legend>
          <div class="choice-grid two" data-r="group-list"></div>
        </fieldset>
        <fieldset class="field" data-r="parts-box" hidden>
          <legend data-r="parts-legend">ご希望の部位 <em>必須</em>（いくつでも選べます）</legend>
          <div class="choice-grid two" data-r="parts-list"></div>
        </fieldset>
        <div data-r="cream-box" hidden>
          <fieldset class="field">
            <legend>麻酔クリーム <em>必須</em></legend>
            <div class="choice-grid two tt-two">
<?php foreach (TattooBooking::YES_NO as $ok => $olabel): ?>
              <label class="pill"><input type="radio" name="cream" value="<?= $h($ok) ?>"><span><?= $h($olabel) ?></span></label>
<?php endforeach; ?>
            </div>
            <small class="field-note">約両手面積あたり<?= number_format(TattooBooking::CREAM_YEN) ?>円（税込）。効果が出るまで約1時間かかります</small>
          </fieldset>
        </div>
        <div data-r="needle-box" hidden>
          <fieldset class="field">
            <legend>性別 <em>必須</em></legend>
            <div class="choice-grid two tt-two">
<?php foreach (TattooBooking::NEEDLE_SEX as $ok => $olabel): ?>
              <label class="pill"><input type="radio" name="sex" value="<?= $h($ok) ?>"><span><?= $h($olabel) ?></span></label>
<?php endforeach; ?>
            </div>
          </fieldset>
          <label class="field"><span>VIO の本数</span><input name="countVio" type="number" inputmode="numeric" min="0" max="5000" step="1" placeholder="受けない場合は空のまま"></label>
          <label class="field"><span>VIO以外（体毛・眉など）の本数</span><input name="countOther" type="number" inputmode="numeric" min="0" max="5000" step="1" placeholder="受けない場合は空のまま"></label>
          <p class="field-note">同じ日に両方受ける場合は、それぞれの本数を入力してください（どちらか一方は必須）。本数によってご予約いただける時間が変わります。わからない場合は LINE でご相談ください</p>
          <fieldset class="field">
            <legend>局所麻酔注射 <em>必須</em></legend>
            <div class="choice-grid two tt-two">
<?php foreach (TattooBooking::YES_NO as $ok => $olabel): ?>
              <label class="pill"><input type="radio" name="needleAnes" value="<?= $h($ok) ?>"><span><?= $h($olabel) ?></span></label>
<?php endforeach; ?>
            </div>
            <small class="field-note">約両手面積あたり<?= number_format(TattooBooking::INJECTION_YEN) ?>円（税込）</small>
          </fieldset>
          <p class="field-note">針は1本分の料金を含みます。毛の太さ・深さが異なる部位を施術する場合は、それに合わせた別の針を別途ご購入いただく必要がございます。</p>
        </div>
        <label class="field" data-r="count-box" hidden><span>本数 <em>必須</em></span><input name="count" type="number" inputmode="numeric" min="1" max="5000" step="1" placeholder="前回お伝えした本数（例：300）"><small class="field-note">本数によってご予約いただける時間が変わります。わからない場合は LINE でご相談ください</small></label>
        <p class="tt-area-result" data-r="needle-est" aria-live="polite" hidden></p>

        <div class="tt-area" data-r="area-box" hidden>
          <p class="tt-area-title">希望照射面積 <em>必須</em></p>
          <p class="field-note" data-r="area-help">タトゥーをすべて含めることのできる長方形を考え、その長い辺と短い辺をcmで入力してください。</p>
          <div class="tt-rect" data-rect="0">
            <span class="tt-rect-label" data-r="rect0-label">長方形</span>
            <label><input name="r0a" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="長い辺"><span>cm ×</span></label>
            <label><input name="r0b" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="短い辺"><span>cm</span></label>
          </div>
          <div class="tt-rect" data-rect="1" data-r="rect1" hidden>
            <span class="tt-rect-label">右眉</span>
            <label><input name="r1a" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="長い辺"><span>cm ×</span></label>
            <label><input name="r1b" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" placeholder="短い辺"><span>cm</span></label>
          </div>
          <p class="tt-area-result" data-r="area-result" aria-live="polite"></p>
        </div>

        <fieldset class="field" data-r="color-box" hidden>
          <legend>インクの色（任意）</legend>
          <div class="choice-grid two">
            <label class="pill"><input type="radio" name="color" value="black"><span>黒のみ</span></label>
            <label class="pill"><input type="radio" name="color" value="color"><span>カラーあり</span></label>
          </div>
        </fieldset>
        <label class="field"><span>部位（任意）</span><input name="part" maxlength="60" placeholder="例：左腕・眉"></label>
        <fieldset class="field" data-r="anes-box">
          <legend>局所麻酔注射（任意）</legend>
          <div class="choice-grid two">
            <label class="pill"><input type="radio" name="anesthesia" value="no" checked><span>希望しない</span></label>
            <label class="pill"><input type="radio" name="anesthesia" value="yes"><span>希望する</span></label>
          </div>
          <small class="field-note">極細の針による麻酔注射です（1ccあたり5,500円・税込）</small>
        </fieldset>
        </div>
          </div>
        </template>
        <button type="button" class="tt-add" id="add-entry">＋ 希望施術を追加</button>
        <p class="field-note tt-consult" id="consult-note" hidden><?= $h(TattooBooking::CONSULT_NOTICE) ?></p>
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
        <p class="field-note" id="duration-note" hidden></p>
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
        <label class="field"><span>メールアドレス <em>必須</em></span><input name="email" type="email" autocomplete="email" maxlength="200" placeholder="ご予約確定のメールをお送りします"></label>
        <label class="field"><span>ご相談・お伝えしたいこと（任意）</span><textarea name="notes" rows="3" maxlength="400"></textarea></label>
        <div class="tt-guard" id="guard-box" role="note" hidden></div>
        <label class="tt-trap" aria-hidden="true">ウェブサイト<input name="website" tabindex="-1" autocomplete="off"></label>
<?php if ($p['privacyUrl'] !== ''): ?>
        <p class="field-note">ご入力の内容は、<a href="<?= $h($p['privacyUrl']) ?>" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>に沿って取り扱います。</p>
<?php endif; ?>
      </section>

      <section class="card tt-visit tt-consent">
        <h2 class="tt-consent-title">同意事項</h2>
        <p class="tt-consent-lead">以下の各項目をお読みの上、ご同意いただけましたらチェックを入れてください。</p>
        <div class="tt-consent-item">
          <label class="tt-agree-head"><input type="checkbox" name="agreeBefore" value="1" data-agree><em>必須</em><b>ご来院前のお願い</b></label>
          <p>・<?= TattooBooking::strongHtml(TattooBooking::NO_MAKEUP) ?></p>
          <p>・<?= TattooBooking::strongHtml(TattooBooking::DELICATE_NOTICE) ?></p>
<?php if ($tattooOn): ?>
          <p>・<?= $items !== [] ? '<strong>タトゥー・アートメイク除去の方</strong>：' : '' ?><?= $h(TattooBooking::SHAVE_NOTICE_PAGE) ?></p>
<?php endif; ?>
          <p>・<?= TattooBooking::strongHtml(TattooBooking::CONSULT_NOTICE) ?></p>
        </div>
        <div class="tt-consent-item">
          <label class="tt-agree-head"><input type="checkbox" name="agreeVisit" value="1" data-agree><em>必須</em><b>日曜日のご来院について</b></label>
<?php foreach (TattooBooking::VISIT_NOTICE as $line): ?>
          <p>・<?= TattooBooking::strongHtml($line) ?></p>
<?php endforeach; ?>
        </div>
        <div class="tt-consent-item">
          <label class="tt-agree-head"><input type="checkbox" name="agreeCancel" value="1" data-agree><em>必須</em><b>キャンセル・日程変更にかかる料金規定</b></label>
<?php foreach (TattooBooking::CANCEL_POLICY as $line): ?>
          <p>・<?= $h($line) ?></p>
<?php endforeach; ?>
        </div>
        <label class="tt-agree tt-agree-all"><span class="tt-agree-head"><input type="checkbox" name="agreeAll" value="1"><b>すべてに同意しました</b></span></label>
      </section>

      <div class="error-summary" id="error-summary" role="alert" hidden></div>
      <button class="submit-button" type="submit" id="submit-button">この内容で予約する</button>
    </form>

    <section class="card centered" id="done" hidden>
      <div class="complete-mark">✓</div>
      <h2>ご予約を承りました</h2>
      <p class="tt-q" id="done-q" hidden><?= $h(TattooBooking::QUESTIONNAIRE_ASK) ?><a class="submit-button" id="done-q-link" href="#" target="_blank" rel="noopener">問診票を回答する</a></p>
      <p id="done-when"></p>
      <p id="done-mail"></p>
      <div class="tt-visit">
        <div class="shave-notice">
          <h3>ご来院前のお願い</h3>
          <p><?= $h(TattooBooking::NO_MAKEUP) ?></p>
          <p id="done-before" style="white-space:pre-line" data-shave="<?= $h(TattooBooking::SHAVE_NOTICE_PAGE) ?>"<?= $tattooOn ? '' : ' hidden' ?>><?= $tattooOn ? $h(TattooBooking::SHAVE_NOTICE_PAGE) : '' ?></p>
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
    <script type="application/json" id="guard-rules"><?= json_encode(InsuranceGuard::forPage(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
    <script src="../assets/insurance-guard.js?v=<?= $v ?>"></script>
    <script type="module" src="./app.js?v=<?= $v ?>" data-liff="<?= $h($liffId) ?>"></script>
<?php endif; ?>
  </main>
</body>
</html>
