// タトゥー・アートメイク除去（日曜）の Web 予約ページ。面積と初診・再診から、選べる日と来院の時刻を読み、予約する
const form = document.querySelector('#tt-form');
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
let loadedKey = '';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ja = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
};
const val = (name) => String(new FormData(form).get(name) || '');
const num = (name) => {
  const n = Number(String(form.elements[name].value).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0;
};

/** 入力された長方形（タトゥーは1つ、眉は左右それぞれ。片方だけでもよい） */
function rects() {
  const kind = val('kind');
  const out = [];
  const a0 = num('r0a'), b0 = num('r0b'), a1 = num('r1a'), b1 = num('r1b');
  if (a0 && b0) out.push([a0, b0]);
  if (kind === 'artmake' && a1 && b1) out.push([a1, b1]);
  return out;
}
const areaOf = (rs) => Math.ceil(rs.reduce((s, [a, b]) => s + a * b, 0) * 10 - 1e-9) / 10;
const fmt = (n) => String(Math.round(n * 10) / 10);

function syncInputs() {
  const kind = val('kind');
  document.querySelector('#area-box').hidden = !kind;
  document.querySelector('#color-box').hidden = kind !== 'tattoo';
  document.querySelector('#rect1').hidden = kind !== 'artmake';
  document.querySelector('#rect0-label').textContent = kind === 'artmake' ? '左眉' : '長方形';
  document.querySelector('#area-help').textContent = kind === 'artmake'
    ? '左右の眉を別々に、眉をすべて含めることのできる長方形の長い辺と短い辺をcmで入力してください（片方だけの場合は片方のみ）。'
    : 'タトゥーをすべて含めることのできる長方形を考え、その長い辺と短い辺をcmで入力してください。';
  const rs = rects();
  const area = rs.length ? areaOf(rs) : 0;
  const ready = area > 0 && !!val('visit');
  document.querySelector('#date-card').hidden = !ready;
  const result = document.querySelector('#area-result');
  result.textContent = area > 0 ? `希望照射面積：${fmt(area)}cm²` : '';
  const key = ready ? `${area}|${val('visit')}` : '';
  if (key !== loadedKey) {
    loadedKey = key;
    selected = '';
    slots = {};
    if (key) load(area);
    else render();
  }
}

async function load(area) {
  const key = loadedKey;
  let price = 0;
  let duration = '';
  try {
    const res = await fetch(`./api.php?area=${encodeURIComponent(area)}&visit=${encodeURIComponent(val('visit'))}`, { cache: 'no-store' });
    const data = await res.json();
    if (key !== loadedKey) return;
    slots = data.slots && typeof data.slots === 'object' ? data.slots : {};
    price = Number(data.price) || 0;
    duration = typeof data.duration === 'string' ? data.duration : '';
  } catch (_) {
    slots = {};
  }
  if (price) {
    document.querySelector('#area-result').textContent = `希望照射面積：${fmt(area)}cm²／1回の料金の目安：${price.toLocaleString('ja-JP')}円（税込・麻酔代別）${duration ? `／所要時間の目安：${duration}` : ''}`;
  }
  if (selected && !(slots[selected] || []).length) selected = '';
  const first = Object.keys(slots).sort()[0];
  document.querySelector('#no-slots').hidden = !!first;
  const base = first ? new Date(`${first}T00:00:00`) : new Date();
  cursor = new Date(base.getFullYear(), base.getMonth(), 1);
  render();
}

function render() {
  if (!cursor) cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
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
    span.textContent = `${t} ご来院`;
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
  kind: '除去したいものを選んでください', visit: 'はじめてか2回目以降かを選んでください', area: '希望照射面積（長い辺・短い辺）を入力してください',
  name: 'お名前を入力してください', kana: 'フリガナを入力してください', birthDate: '生年月日を正しく入力してください',
  phone: '電話番号を半角数字で入力してください', email: 'メールアドレスを正しく入力してください', slot: 'ご希望の日時を選んでください',
};

form.addEventListener('input', (e) => { if (!['time', 'name', 'kana', 'birthDate', 'phone', 'email', 'lineName', 'notes', 'part'].includes(e.target.name)) syncInputs(); });
form.addEventListener('change', (e) => { if (['kind', 'visit'].includes(e.target.name)) syncInputs(); });

// LINE の中で開いたとき（LIFF）：本人の LINE を確かめ、確定の連絡を LINE へ（メールは任意）
let idToken = '';
async function startLine() {
  const id = document.querySelector('script[data-liff]')?.dataset.liff || '';
  if (!id || !window.liff) return;
  try {
    await window.liff.init({ liffId: id });
    if (!window.liff.isInClient() && !window.liff.isLoggedIn()) return;
    idToken = window.liff.getIDToken() || '';
  } catch (_) {
    idToken = '';
  }
  if (idToken) {
    document.querySelector('#line-note').hidden = false;
    document.querySelector('#email-label').innerHTML = 'メールアドレス（任意）';
    document.querySelector('[name="email"]').placeholder = 'LINE が届かないときのために（任意）';
  }
}
startLine();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(form);
  const body = Object.fromEntries(['kind', 'visit', 'color', 'part', 'anesthesia', 'name', 'kana', 'birthDate', 'phone', 'email', 'lineName', 'notes', 'website'].map((k) => [k, String(fd.get(k) || '')]));
  body.rects = rects();
  body.date = selected;
  body.time = String(fd.get('time') || '');
  if (idToken) body.idToken = idToken;
  const local = [];
  if (!body.kind) local.push(LABELS.kind);
  if (!body.visit) local.push(LABELS.visit);
  if (!body.rects.length) local.push(LABELS.area);
  if (!body.date || !body.time) local.push(LABELS.slot);
  if (!body.name.trim()) local.push(LABELS.name);
  if (!body.kana.trim()) local.push(LABELS.kana);
  if (!body.birthDate) local.push(LABELS.birthDate);
  if (!/^0\d{9,10}$/.test(body.phone.replace(/[-ー\s]/g, ''))) local.push(LABELS.phone);
  if ((!idToken || body.email.trim() !== '') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) local.push(LABELS.email);
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
      document.querySelector('#done-when').textContent = `${ja(body.date)} ${body.time}〜${data.end || ''}（${data.duration || ''}）。${body.time} にご来院ください`;
      document.querySelector('#done-mail').textContent = data.lined
        ? 'LINE に、ご予約の内容をお送りしました。'
        : data.mailed
          ? 'ご入力のメールアドレスに、ご予約の内容をお送りしました。'
          : 'ご予約の内容をお送りできませんでした。ご予約は承っております。';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (data.error === 'slot_taken') {
      await load(areaOf(body.rects));
      showErrors(['選んだ時刻は、先にご予約が入りました。別の日時をお選びください']);
    } else if (data.error === 'invalid') {
      showErrors((data.fields || []).map((f) => LABELS[f]).filter(Boolean));
    } else if (data.error === 'rate_limited') {
      showErrors(['送信が続いたため、しばらく受け付けられません。時間をおいてお試しください']);
    } else if (data.error === 'contact_us') {
      showErrors(['ご予約を受け付けられませんでした。お手数ですが、当院の LINE からご連絡ください']);
    } else if (data.error === 'line_auth') {
      showErrors(['LINE の確認ができませんでした。お手数ですが、LINE で開き直してください']);
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
syncInputs();
