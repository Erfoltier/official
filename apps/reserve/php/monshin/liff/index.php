<?php
/**
 * LINE の中で開く問診票（LIFF）。LINE Developers の LIFF アプリのエンドポイント URL に https://monshin.…/liff/ を入れる。
 * 開いた人を LINE で確かめ、その人の予約の問診票だけを出す。氏名・生年月日など、院にある情報はもう一度書かせない
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';
require __DIR__ . '/../theme.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' https://static.line-scdn.net; connect-src 'self' https://*.line.me https://*.line-scdn.net; style-src 'unsafe-inline'; img-src 'self' data: https://*.line-scdn.net; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
header_remove('X-Powered-By');

try {
    $liffId = LineLink::settings()['liffId'];
    $clinic = Store::clinic()['name'] ?? '';
} catch (Throwable $e) {
    $liffId = '';
    $clinic = '';
}
$test = LineLink::testMode();
$h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>問診票｜<?= $h($clinic) ?></title>
<style><?= monshin_style('../') ?></style>
</head>
<body>
<main>
<?= monshin_header('../', '問診票', $clinic) ?>
<div id="app"><p class="muted">読み込み中…</p></div>
</main>
<?php if (!$test): ?><script src="https://static.line-scdn.net/liff/edge/2/sdk.js" charset="utf-8"></script><?php endif; ?>
<script>
(() => {
  const LIFF_ID = <?= json_encode($liffId) ?>;
  const TEST = <?= $test ? 'true' : 'false' ?>;
  const app = document.getElementById('app');
  let idToken = '', ctx = null;
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    kids.flat().forEach((k) => k && e.append(k));
    return e;
  };
  const show = (...nodes) => { app.replaceChildren(...nodes); window.scrollTo(0, 0); };
  const fail = (text) => show(el('div', { class: 'alert', role: 'alert', text }));
  const api = async (body) => {
    const res = await fetch('./api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken, ...body }) });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  const when = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };

  function list() {
    const items = ctx.items;
    if (items.length === 0) {
      return show(el('div', { class: 'card' }, el('p', { text: 'ご予約が確定しましたら、こちらから問診票をご記入いただけます。' }), el('p', { class: 'muted', text: 'ご予約確定のご連絡後にもう一度開いてください。' })));
    }
    if (items.length === 1) return items[0].done ? doneView(items[0]) : form(items[0]);
    show(el('p', { text: 'どのご予約の問診票を記入しますか？' }), ...items.map((it) => el('div', { class: 'card' },
      el('div', { text: `${when(it.startAt)}　${it.name} 様` }),
      it.done ? el('div', {}, el('p', { class: 'muted', text: '記入済みです（ご来院日まで修正できます）' }), el('button', { type: 'button', class: 'sub', onclick: () => form(it), text: '内容を確認・修正する' })) : el('button', { type: 'button', onclick: () => form(it), text: '記入する' }),
    )));
  }

  function doneView(it) {
    show(
      el('div', { class: 'card pre', text: ctx.done }),
      el('p', { class: 'muted', text: 'ご来院日までは、内容を確認・修正できます。' }),
      it ? el('button', { type: 'button', class: 'sub', onclick: () => form(it), text: '内容を確認・修正する' }) : null,
    );
  }

  function form(it, errors = {}, values = it.answers || {}) {
    const known = new Set(it.known.map((k) => k.id));
    const f = el('form', { novalidate: '' });
    const fields = ctx.questions.filter((q) => !known.has(q.id)).map((q) => {
      const name = 'q_' + q.id;
      const req = q.required ? el('span', { class: 'req', text: '必須' }) : null;
      let input;
      if (q.type === 'choice' || q.type === 'multi') {
        input = el('div', {}, ...q.options.map((o) => {
          const c = el('input', { type: q.type === 'multi' ? 'checkbox' : 'radio', name, value: o });
          const v = values[name];
          if (Array.isArray(v) ? v.includes(o) : v === o) c.checked = true;
          return el('label', { class: 'opt' }, c, o);
        }));
      } else if (q.type === 'textarea') {
        input = el('textarea', { name, maxlength: '2000' });
        input.value = values[name] || '';
      } else {
        input = el('input', { name, type: q.type, maxlength: '200' });
        input.value = values[name] || '';
      }
      return el('div', { class: 'card' }, el('span', { class: 'q' }, q.label, req), input, errors[q.id] ? el('p', { class: 'msg', text: errors[q.id] }) : null);
    });
    const knownCard = it.known.length ? el('div', { class: 'card' },
      el('p', { class: 'muted', text: 'ご予約時の情報を使います（ご記入は不要です）。違うときは、来院時に受付でお知らせください。' }),
      el('dl', { class: 'known' }, ...it.known.flatMap((k) => [el('dt', { text: k.label }), el('dd', { text: k.value })])),
    ) : null;
    const submit = el('button', { type: 'submit', text: '送信する' });
    f.append(...fields, submit);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f), answers = {};
      for (const [k, v] of fd.entries()) {
        if (ctx.questions.find((q) => 'q_' + q.id === k)?.type === 'multi') (answers[k] ||= []).push(v); else answers[k] = v;
      }
      submit.disabled = true;
      submit.textContent = '送信中…';
      try {
        const { status, data } = await api({ action: 'submit', reservationId: it.reservationId, answers });
        if (status === 200 && data.ok) { it.done = true; it.answers = answers; it.fromPrevious = false; return doneView(it); }
        if (status === 400 && data.errors && Object.keys(data.errors).length) {
          form(it, data.errors, answers);
          app.prepend(el('div', { class: 'alert', role: 'alert', text: '入力内容をご確認ください。' }));
          return;
        }
        fail(data.message || '送信できませんでした。時間をおいてもう一度お試しください。');
      } catch {
        fail('通信できませんでした。電波の良いところでもう一度お試しください。');
      }
    });
    const note = it.done
      ? el('div', { class: 'intro', text: '送信済みの内容です。直したいところを書き換えて、もう一度送信してください。' })
      : it.fromPrevious
        ? el('div', { class: 'intro', text: '前回の問診票の内容を入れてあります。変わったところだけ書き換えて送信してください。' })
        : null;
    show(el('p', { class: 'muted', text: `ご予約：${when(it.startAt)}　${it.name} 様` }), ctx.intro ? el('p', { class: 'pre', text: ctx.intro }) : null, note, knownCard, f);
  }

  async function start() {
    try {
      if (TEST) {
        idToken = 'test:' + (new URLSearchParams(location.search).get('u') || '');
      } else {
        if (!LIFF_ID || !window.liff) return fail('ただいま問診票を開けません。お手数ですが、お電話でお知らせください。');
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
        idToken = liff.getIDToken() || '';
      }
      const { status, data } = await api({ action: 'context' });
      if (status !== 200 || !data.ok) return fail(data.message || '問診票を開けませんでした。LINE で開き直してください。');
      ctx = data;
      document.getElementById('title').textContent = data.title || '問診票';
      list();
    } catch {
      fail('問診票を開けませんでした。LINE で開き直してください。');
    }
  }
  start();
})();
</script>
</body>
</html>
