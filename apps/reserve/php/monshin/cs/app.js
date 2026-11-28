// オンラインカウンセリングの Web 予約ページ。選べる枠（日付 => 開始時刻）を読み、選んだ日の空き時間を出して予約する
const form = document.querySelector('#cs-form');
const grid = document.querySelector('#calendar-grid');
const title = document.querySelector('#calendar-title');
const selectedLabel = document.querySelector('#selected-date');
const times = document.querySelector('#times');
const errorBox = document.querySelector('#error-summary');
const submit = document.querySelector('#submit-button');
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
let slots = {};
let selected = '';
let cursor = null;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ja = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
};
const endOf = (t) => {
  const [h, m] = t.split(':').map(Number);
  const e = h * 60 + m + 15;
  return `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
};

async function load() {
  try {
    const res = await fetch('./api.php', { cache: 'no-store' });
    const data = await res.json();
    slots = data.slots && typeof data.slots === 'object' ? data.slots : {};
  } catch (_) {
    slots = {};
  }
  if (selected && !(slots[selected] || []).length) selected = '';
  const first = Object.keys(slots).sort()[0];
  document.querySelector('#no-slots').hidden = !!first;
  if (!cursor) {
    const base = first ? new Date(`${first}T00:00:00`) : new Date();
    cursor = new Date(base.getFullYear(), base.getMonth(), 1);
  }
  render();
}

function render() {
  title.textContent = `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月`;
  grid.replaceChildren();
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  for (let i = 0; i < firstDay; i += 1) grid.append(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const d = iso(new Date(cursor.getFullYear(), cursor.getMonth(), day));
    const b = document.createElement('button');
    const ok = (slots[d] || []).length > 0;
    b.type = 'button';
    b.textContent = String(day);
    b.disabled = !ok;
    b.className = d === selected ? 'selected' : '';
    b.setAttribute('aria-label', `${ja(d)}${ok ? '' : ' 選択不可'}`);
    b.addEventListener('click', () => { selected = d; render(); });
    grid.append(b);
  }
  const months = Object.keys(slots).map((d) => d.slice(0, 7)).sort();
  const cur = iso(cursor).slice(0, 7);
  document.querySelector('#prev-month').disabled = !months.some((m) => m < cur);
  document.querySelector('#next-month').disabled = !months.some((m) => m > cur);
  selectedLabel.textContent = selected ? `ご希望日：${ja(selected)}` : '日付を選んでください';
  const checked = form.querySelector('input[name="time"]:checked')?.value;
  times.replaceChildren();
  for (const t of slots[selected] || []) {
    const label = document.createElement('label');
    label.className = 'pill';
    const input = document.createElement('input');
    Object.assign(input, { type: 'radio', name: 'time', value: t, checked: t === checked });
    const span = document.createElement('span');
    span.textContent = t;
    label.append(input, span);
    times.append(label);
  }
}

function move(n) {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
  render();
}

function showErrors(list) {
  errorBox.hidden = false;
  errorBox.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = 'ご確認ください';
  const ul = document.createElement('ul');
  for (const e of list) {
    const li = document.createElement('li');
    li.textContent = e;
    ul.append(li);
  }
  errorBox.append(strong, ul);
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const LABELS = {
  name: 'お名前を入力してください', kana: 'フリガナを入力してください', birthDate: '生年月日を正しく入力してください',
  phone: '電話番号を半角数字で入力してください', email: 'メールアドレスを正しく入力してください',
  jointUseConsent: '個人情報の共同利用への同意が必要です', slot: 'ご希望の日時を選んでください',
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(form);
  const body = Object.fromEntries(['name', 'kana', 'birthDate', 'phone', 'email', 'lineName', 'orderNo', 'website', 'jointUseConsent'].map((k) => [k, String(fd.get(k) || '')]));
  body.date = selected;
  body.time = String(fd.get('time') || '');
  const local = [];
  if (!body.date || !body.time) local.push(LABELS.slot);
  if (!body.name.trim()) local.push(LABELS.name);
  if (!body.kana.trim()) local.push(LABELS.kana);
  if (!body.birthDate) local.push(LABELS.birthDate);
  if (!/^0\d{9,10}$/.test(body.phone.replace(/[-ー\s]/g, ''))) local.push(LABELS.phone);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) local.push(LABELS.email);
  if (body.jointUseConsent !== 'agreed') local.push(LABELS.jointUseConsent);
  if (local.length) { showErrors(local); return; }
  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = '送信中…';
  try {
    const res = await fetch('./api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      form.hidden = true;
      document.querySelector('#done').hidden = false;
      document.querySelector('#done-when').textContent = `${ja(body.date)} ${body.time}〜${endOf(body.time)}`;
      document.querySelector('#done-mail').textContent = data.mailed
        ? 'ご入力のメールアドレスに、ご予約の内容をお送りしました。'
        : '確認のメールをお送りできませんでした。ご予約は承っております。';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (data.error === 'slot_taken') {
      await load();
      showErrors(['選んだ時間は、先にご予約が入りました。別の日時をお選びください']);
    } else if (data.error === 'invalid') {
      showErrors((data.fields || []).map((f) => LABELS[f]).filter(Boolean));
    } else if (data.error === 'rate_limited') {
      showErrors(['送信が続いたため、しばらく受け付けられません。時間をおいてお試しください']);
    } else if (data.error === 'contact_us') {
      showErrors(['ご予約を受け付けられませんでした。お手数ですが、シミクレールの LINE からご連絡ください']);
    } else if (data.error === 'closed') {
      showErrors(['現在、ご予約は受け付けておりません']);
    } else {
      showErrors(['送信できませんでした。時間をおいてお試しください']);
    }
  } catch (_) {
    showErrors(['送信できませんでした。通信の状態をご確認ください']);
  } finally {
    submit.disabled = false;
    submit.textContent = 'この内容で予約する';
  }
});

document.querySelector('#prev-month').addEventListener('click', () => move(-1));
document.querySelector('#next-month').addEventListener('click', () => move(1));
document.querySelector('[name="birthDate"]').max = iso(new Date());
load();
