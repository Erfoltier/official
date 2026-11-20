// 日曜の Web 予約ページ。希望施術（タトゥー・アートメイク除去、院が許可した日曜メニュー）を1つ以上選び、
// 当院の初診・再診と施術ごとの当日施術のご希望から、選べる日と来院の時刻を読み、予約する（院長 11/20：複数の施術・相談のみ）
const form = document.querySelector('#tt-form');
const grid = document.querySelector('#calendar-grid');
const title = document.querySelector('#calendar-title');
const selectedLabel = document.querySelector('#selected-date');
const times = document.querySelector('#times');
const errorBox = document.querySelector('#error-summary');
const submit = document.querySelector('#submit-button');
const entriesBox = document.querySelector('#entries');
const tpl = document.querySelector('#entry-tpl');
const addButton = document.querySelector('#add-entry');
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const MAX_ENTRIES = 6;
let slots = {};
let selected = '';
let cursor = null;
let loadedKey = '';
let lineName = '';
let seq = 0;

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ja = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
};
const val = (name) => String(new FormData(form).get(name) || '');
const half = (v) => String(v).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// ---- 希望施術（1つずつの囲み）。囲みの中の入力の名前は「名前__番号」 ----
const entries = () => [...entriesBox.querySelectorAll('.tt-entry')];
const R = (en, r) => en.querySelector(`[data-r="${r}"]`);
const inputs = (en, name) => [...en.querySelectorAll(`[name="${name}__${en.dataset.n}"]`)];
/** 囲みの中の入力の値（ラジオは選んだもの） */
function ev(en, name) {
  const els = inputs(en, name);
  if (!els.length) return '';
  if (els[0].type === 'radio' || els[0].type === 'checkbox') return els.find((x) => x.checked)?.value || '';
  return String(els[0].value || '');
}
const numOf = (en, name) => {
  const n = Number(half(ev(en, name)));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0;
};
const intOf = (en, name) => {
  const n = Number(half(ev(en, name)));
  return Number.isInteger(n) && n >= 0 && n <= 5000 ? n : 0;
};
const countVal = (en) => {
  const n = intOf(en, 'count');
  return n >= 1 ? n : 0;
};
const needleTotal = (en) => intOf(en, 'countVio') + intOf(en, 'countOther');
const kindOf = (en) => ev(en, 'kind');
/** 選んだ日曜メニュー（タトゥー以外）のラジオボタン。タトゥー・アートメイク・未選択なら null */
const itemOf = (en) => {
  const el = inputs(en, 'kind').find((x) => x.checked);
  return el && el.value.startsWith('m:') ? el : null;
};
const isRemoval = (en) => ['tattoo', 'artmake'].includes(kindOf(en));
const groupsOf = (item) => JSON.parse(item?.dataset.groups || '[]');
const checkedParts = (en) => inputs(en, 'parts').filter((x) => x.checked).map((x) => x.value);
const areaOf = (rs) => Math.ceil(rs.reduce((s, [a, b]) => s + a * b, 0) * 10 - 1e-9) / 10;
const fmt = (n) => String(Math.round(n * 10) / 10);

/** 入力された長方形（タトゥーは1つ、眉は左右それぞれ。片方だけでもよい） */
function rects(en) {
  const out = [];
  const a0 = numOf(en, 'r0a'), b0 = numOf(en, 'r0b'), a1 = numOf(en, 'r1a'), b1 = numOf(en, 'r1b');
  if (a0 && b0) out.push([a0, b0]);
  if (kindOf(en) === 'artmake' && a1 && b1) out.push([a1, b1]);
  return out;
}

/** 区分を選んだら、その区分の部位のチェックを作り直す */
function renderParts(en) {
  const it = itemOf(en);
  const pl = R(en, 'parts-list');
  const g = groupsOf(it)[Number(ev(en, 'group'))];
  pl.replaceChildren();
  if (!g) return;
  // ほくろの個数など、1つだけ選ぶものはラジオ
  const one = !!it && it.dataset.one === '1';
  const lab = (it && it.dataset.pickLabel) || '部位';
  R(en, 'parts-legend').innerHTML = `ご希望の${lab.replace(/[<>&"]/g, '')} <em>必須</em>${one ? '' : '（いくつでも選べます）'}`;
  g.parts.forEach((name, i) => {
    const label = document.createElement('label');
    label.className = 'pill';
    const input = Object.assign(document.createElement('input'), { type: one ? 'radio' : 'checkbox', name: `parts__${en.dataset.n}`, value: String(i) });
    const span = document.createElement('span');
    span.textContent = name;
    label.append(input, span);
    pl.append(label);
  });
}

/** その施術の区分（初診の時間 first・再診の時間 repeat）。当院の初診 → first、再診は今回の治療内容で（麻酔つきの注入は再診なら repeat） */
function visitOf(en) {
  const cv = val('clinicVisit');
  const st = ev(en, 'status');
  const flow = itemOf(en)?.dataset.flow === '1';
  return cv === 'initial' ? 'first' : cv === 'returning' ? (flow ? 'repeat' : st === '' ? '' : st === 'new' ? 'first' : 'repeat') : '';
}
const sameDay = (en) => ev(en, 'sameDay');

/** 施術ごとの内容がそろっているか（当日施術なしなら施術を選ぶだけ） */
function entryReady(en) {
  if (!kindOf(en) || !sameDay(en)) return false;
  if (sameDay(en) === '無') return !!val('clinicVisit');
  if (!visitOf(en) || en.dataset.ok !== '1') return false;
  if (val('clinicVisit') === 'returning' && !ev(en, 'status')) return false;
  const item = itemOf(en);
  if (!item) return rects(en).length > 0;
  const partsOk = !groupsOf(item).length || (ev(en, 'group') !== '' && checkedParts(en).length > 0);
  // 麻酔つきの注入：範囲（炭酸ガスの全顔・部分など）があれば、それも
  if (item.dataset.flow === '1') return visitOf(en) !== 'repeat' || (ev(en, 'status') !== '' && ev(en, 'anesthesiaType') !== '' && partsOk);
  // レーザー脱毛：麻酔クリームの有無も
  if (item.dataset.cream === '1' && !ev(en, 'cream')) return false;
  if (groupsOf(item).length) return partsOk;
  // 針脱毛：VIO・VIO以外の本数（どちらか）と、料金の概算のための性別・局所麻酔注射の有無
  if (item.dataset.needle === '1') return needleTotal(en) > 0 && !!ev(en, 'sex') && !!ev(en, 'needleAnes');
  if (item.dataset.count === '1') return countVal(en) > 0;
  return true;
}

/** 送るときの施術1つの内容 */
function entryBody(en) {
  const item = itemOf(en);
  const b = { kind: kindOf(en), sameDay: sameDay(en), status: ev(en, 'status'), part: ev(en, 'part') };
  if (sameDay(en) !== '有') return b;
  if (!item) return { ...b, rects: rects(en), color: ev(en, 'color'), anesthesia: ev(en, 'anesthesia') };
  return {
    ...b, group: ev(en, 'group'), parts: checkedParts(en).map(Number), count: countVal(en), anesthesiaType: ev(en, 'anesthesiaType'),
    sex: ev(en, 'sex'), needleAnes: ev(en, 'needleAnes'), cream: ev(en, 'cream'), countVio: intOf(en, 'countVio'), countOther: intOf(en, 'countOther'),
  };
}

/** 針脱毛の料金の概算を出す（1行に1つずつ。「＋」「＝」の前で改行） */
function showEstimate(en, t) {
  const est = R(en, 'needle-est');
  est.textContent = t ? `料金の概算\n${t.replace(/＋/g, '\n＋').replace('＝', '\n＝').replace('（料金は', '\n（料金は')}` : '';
  est.hidden = !t;
}

/** 1つの囲みの表示を、選んだ施術に合わせる */
function syncEntry(en, index, total) {
  const kind = kindOf(en);
  const item = itemOf(en);
  const flow = !!item && item.dataset.flow === '1';
  const cv = val('clinicVisit');
  R(en, 'entry-title').textContent = total > 1 ? `ご希望の施術 ${index + 1}` : 'ご希望の施術';
  R(en, 'remove').hidden = total < 2;
  // 施術を選んだら、当日施術のご希望を聞く
  R(en, 'sameday-box').hidden = !kind;
  const sd = sameDay(en);
  // 再診の方は、施術ごとに今回の治療内容（当日施術ありのとき。院長 11/20）
  R(en, 'status-box').hidden = !(kind && sd === '有' && cv === 'returning');
  let visit = visitOf(en);
  // 日曜メニューは、受け付けている区分だけ（当日施術なしの相談は、どちらでも）
  const firstOk = !item || item.dataset.first === '1';
  const repeatOk = !item || item.dataset.repeat === '1';
  const note = R(en, 'visit-note');
  note.textContent = '';
  let ok = true;
  if (sd === '有' && visit === 'first' && !firstOk) {
    note.textContent = cv === 'initial'
      ? 'この施術の日曜日のご予約は、当院の美容皮膚科を受診したことのある方のみ承っております'
      : 'この施術の日曜日のご予約は、継続・コース消化・モニターの方のみ承っております';
    ok = false;
  } else if (sd === '有' && visit === 'repeat' && !repeatOk) {
    note.textContent = 'この施術の日曜日のご予約は、はじめての方のみ承っております';
    ok = false;
  } else if (sd === '有' && visit === 'first' && isRemoval(en)) {
    note.textContent = 'はじめての方は、照射の前にご説明（10分）があります';
  } else if (sd === '有' && flow && visit === 'first') {
    note.textContent = '当院がはじめての方は、医師の診察（約20分）のご予約です。施術は診察のうえでご相談となります';
  }
  en.dataset.ok = ok ? '1' : '';
  note.hidden = note.textContent === '';
  const itemNote = R(en, 'item-note');
  itemNote.textContent = item && item.dataset.note ? `ご来院前のお願い：${item.dataset.note}` : '';
  itemNote.hidden = itemNote.textContent === '';
  // 当日施術なし（相談のみ）なら、施術の細かい内容は聞かない
  const opts = R(en, 'options');
  opts.hidden = sd !== '有';
  R(en, 'anes-box').hidden = !!item || !kind;
  // 部位ごとの時間のメニュー（脱毛など）：区分（男性・女性など）と部位。麻酔つきの注入の範囲は、受診したことのある方の施術のときだけ
  const groups = item && !(flow && visit !== 'repeat') ? groupsOf(item) : [];
  const pickKey = item ? `${item.value}|${groups.length}` : '';
  if (pickKey !== en.dataset.built) {
    en.dataset.built = pickKey;
    const gl = R(en, 'group-list');
    gl.replaceChildren();
    groups.forEach((g, i) => {
      const label = document.createElement('label');
      label.className = 'pill';
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: `group__${en.dataset.n}`, value: String(i), checked: groups.length === 1 });
      const span = document.createElement('span');
      span.textContent = g.name;
      label.append(input, span);
      gl.append(label);
    });
    renderParts(en);
  }
  R(en, 'group-box').hidden = groups.length < 2;
  // 選んだ区分の部位が1つだけ（ハイフの「頬または顎下の脂肪集中」など）なら、選んだことにして部位の問いは出さない
  const g = groups[Number(ev(en, 'group'))];
  const onlyOne = !!g && g.parts.length === 1;
  if (onlyOne) inputs(en, 'parts').forEach((x) => { x.checked = true; });
  R(en, 'parts-box').hidden = groups.length === 0 || ev(en, 'group') === '' || onlyOne;
  // 針脱毛は VIO・VIO以外の本数を別々に入れる（ふつうの本数の欄は出さない）
  R(en, 'count-box').hidden = !(item && item.dataset.count === '1' && item.dataset.needle !== '1');
  R(en, 'needle-box').hidden = !(item && item.dataset.needle === '1');
  R(en, 'cream-box').hidden = !(item && item.dataset.cream === '1');
  // 針脱毛の料金の概算：性別・本数・局所麻酔注射がそろったら、日時を選べるかに関係なくすぐ出す（院長 11/20）
  const needleReady = !!item && item.dataset.needle === '1' && sd === '有' && needleTotal(en) > 0 && !!ev(en, 'sex') && !!ev(en, 'needleAnes');
  const estKey = needleReady ? `item=${encodeURIComponent(item.value.slice(2))}&visit=repeat&countVio=${intOf(en, 'countVio')}&countOther=${intOf(en, 'countOther')}&sex=${encodeURIComponent(ev(en, 'sex'))}&needleAnes=${encodeURIComponent(ev(en, 'needleAnes'))}` : '';
  if (estKey !== (en.dataset.estKey || '')) {
    en.dataset.estKey = estKey;
    showEstimate(en, '');
    if (estKey) {
      fetch(`./api.php?${estKey}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => { if (en.dataset.estKey === estKey) showEstimate(en, typeof d.estimate === 'string' ? d.estimate : ''); })
        .catch(() => {});
    }
  }
  // 麻酔つきの注入：当院がはじめての方は医師の診察だけ。受診したことのある方は麻酔も
  R(en, 'flow-box').hidden = !(flow && visit === 'repeat');
  // 麻酔クリームだけのメニュー（炭酸ガス・ダーマペン系）は「麻酔の注射」を出さない
  const noInj = flow && item.dataset.noinj === '1';
  const inj = R(en, 'anes-injection');
  if (inj) {
    inj.hidden = noInj;
    if (noInj) inj.querySelector('input').checked = false;
  }
  inputs(en, 'part')[0].placeholder = item ? '例：額・わき' : '例：左腕・眉';
  R(en, 'area-box').hidden = !isRemoval(en);
  R(en, 'color-box').hidden = kind !== 'tattoo';
  R(en, 'rect1').hidden = kind !== 'artmake';
  R(en, 'rect0-label').textContent = kind === 'artmake' ? '左眉' : '長方形';
  R(en, 'area-help').textContent = kind === 'artmake'
    ? '左右の眉を別々に、眉をすべて含めることのできる長方形の長い辺と短い辺をcmで入力してください（片方だけの場合は片方のみ）。'
    : 'タトゥーをすべて含めることのできる長方形を考え、その長い辺と短い辺をcmで入力してください。';
  const rs = isRemoval(en) ? rects(en) : [];
  const area = rs.length ? areaOf(rs) : 0;
  if (!en.dataset.priced || area === 0) R(en, 'area-result').textContent = area > 0 ? `希望照射面積：${fmt(area)}cm²` : '';
}

/** 施術が1つで当日施術ありなら、今までの1つずつの予約（細かい時間の決め方をそのまま使う）。それ以外は続けて取る予約 */
const singleMode = () => entries().length === 1 && sameDay(entries()[0]) === '有';

/** 1つずつの予約のときに空きを読む条件（今までと同じ） */
function singleQuery(en) {
  const item = itemOf(en);
  const visit = visitOf(en);
  if (!item) return `area=${encodeURIComponent(areaOf(rects(en)))}&visit=${visit}${visit === 'repeat' ? `&status=${encodeURIComponent(ev(en, 'status'))}` : ''}`;
  let q = `item=${encodeURIComponent(item.value.slice(2))}&visit=${visit}`;
  const parts = groupsOf(item).length ? `&group=${encodeURIComponent(ev(en, 'group'))}&parts=${checkedParts(en).join(',')}` : '';
  if (item.dataset.flow === '1') return visit === 'repeat' ? `${q}&status=${encodeURIComponent(ev(en, 'status'))}&anesthesia=${encodeURIComponent(ev(en, 'anesthesiaType'))}${parts}` : q;
  if (visit === 'repeat') q += `&status=${encodeURIComponent(ev(en, 'status'))}`;
  if (item.dataset.cream === '1') q += `&cream=${encodeURIComponent(ev(en, 'cream'))}`;
  if (parts) return q + parts;
  if (item.dataset.needle === '1') return `${q}&countVio=${intOf(en, 'countVio')}&countOther=${intOf(en, 'countOther')}&sex=${encodeURIComponent(ev(en, 'sex'))}&needleAnes=${encodeURIComponent(ev(en, 'needleAnes'))}`;
  if (item.dataset.count === '1') return `${q}&count=${countVal(en)}`;
  return q;
}
/** 続けて取る予約のときの空きを読む条件 */
const planBody = () => ({ clinicVisit: val('clinicVisit'), entries: entries().map(entryBody) });

function syncInputs() {
  const cv = val('clinicVisit');
  document.querySelector('#initial-box').hidden = cv !== 'initial';
  const list = entries();
  list.forEach((en, i) => syncEntry(en, i, list.length));
  addButton.disabled = list.length >= MAX_ENTRIES;
  // 当日施術なし（相談のみ）の施術があるときは、カウンセリング料と最大15分の注意（当日施術の希望が1つもないとき）
  const consultOnly = list.length > 0 && list.every((en) => sameDay(en) === '無');
  document.querySelector('#consult-note').hidden = !consultOnly;
  const ready = !!cv && list.length > 0 && list.every(entryReady);
  document.querySelector('#date-card').hidden = !ready;
  const key = !ready ? '' : singleMode() ? `s|${singleQuery(list[0])}` : `m|${JSON.stringify(planBody())}`;
  if (key !== loadedKey) {
    loadedKey = key;
    selected = '';
    slots = {};
    if (key) load();
    else render();
  }
}

/** 今の選択で、選べる日時を読む */
async function load() {
  const key = loadedKey;
  const list = entries();
  let price = 0;
  let duration = '';
  try {
    const url = singleMode() ? `./api.php?${singleQuery(list[0])}` : `./api.php?plan=${encodeURIComponent(JSON.stringify(planBody()))}`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (key !== loadedKey) return;
    slots = data.slots && typeof data.slots === 'object' ? data.slots : {};
    price = Number(data.price) || 0;
    duration = typeof data.duration === 'string' ? data.duration : '';
  } catch (_) {
    slots = {};
  }
  const durationBox = document.querySelector('#duration-note');
  if (durationBox) {
    durationBox.textContent = !singleMode() && duration ? `所要時間の目安：${duration}` : '';
    durationBox.hidden = durationBox.textContent === '';
  }
  if (price && singleMode()) {
    const en = list[0];
    en.dataset.priced = '1';
    R(en, 'area-result').textContent = `希望照射面積：${fmt(areaOf(rects(en)))}cm²／1回の料金の目安：${price.toLocaleString('ja-JP')}円（税込・麻酔代別）${duration ? `／所要時間の目安：${duration}` : ''}`;
  }
  if (selected && !(slots[selected] || []).length) selected = '';
  const first = Object.keys(slots).sort()[0];
  document.querySelector('#no-slots').hidden = !!first;
  const base = first ? new Date(`${first}T00:00:00`) : new Date();
  cursor = new Date(base.getFullYear(), base.getMonth(), 1);
  render();
}

/** 希望施術の囲みを1つ足す */
function addEntry() {
  if (entries().length >= MAX_ENTRIES) return;
  const n = seq++;
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.n = String(n);
  node.querySelectorAll('[name]').forEach((el) => { el.name = `${el.name}__${n}`; });
  // 局所麻酔注射（タトゥー）は「希望しない」を最初から選んでおく
  node.querySelectorAll(`input[name="anesthesia__${n}"][value="no"]`).forEach((el) => { el.checked = true; });
  R(node, 'remove').addEventListener('click', () => { node.remove(); syncInputs(); });
  entriesBox.append(node);
  syncCats(node);
  syncInputs();
  return node;
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

function showErrors(list, heading = 'ご確認ください') {
  errorBox.hidden = false;
  errorBox.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = heading;
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
  kind: document.querySelector('#entry-tpl').content.querySelector('input[value^="m:"]') ? 'ご希望の施術を選んでください' : '除去したいものを選んでください', visit: 'はじめてか2回目以降かを選んでください', clinicVisit: '当院の美容皮膚科の初診・再診を選んでください', initialInfo: '保険通院歴を選んでください', status: '今回の治療内容を選んでください', area: '希望照射面積（長い辺・短い辺）を入力してください',
  name: 'お名前を入力してください', kana: 'フリガナを入力してください', birthDate: '生年月日を正しく入力してください', sameDay: '施術ごとに当日施術のご希望（有・無）を選んでください', entries: 'ご希望の施術を選び直してください',
  phone: '電話番号を半角数字で入力してください', parts: 'ご希望の部位を選んでください', flow: '今回の治療内容と麻酔を選んでください', count: '本数を入力してください', needle: '性別と局所麻酔注射の有無を選んでください', needleCount: 'VIO または VIO以外の本数を入力してください', cream: '麻酔クリームの有無を選んでください', agree: '「ご来院前のお願い」から「料金規定」までを読み、了承のチェックを入れてください', email: 'メールアドレスを正しく入力してください', slot: 'ご希望の日時を選んでください',
};

form.addEventListener('input', (e) => { if (!['time', 'name', 'kana', 'birthDate', 'phone', 'email', 'notes', 'agree'].includes(e.target.name)) syncInputs(); });
form.addEventListener('change', (e) => {
  const en = e.target.closest('.tt-entry');
  const base = String(e.target.name || '').split('__')[0];
  if (en && base === 'group') renderParts(en);
  if (en && base === 'cat') syncCats(en);
  syncInputs();
});
addButton.addEventListener('click', () => {
  const node = addEntry();
  node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

let idToken = '';
const gate = document.querySelector('#line-gate');
const showGate = (mode) => {
  if (!gate) return;
  form.hidden = mode !== '';
  gate.hidden = mode === '';
  if (mode === 'open') {
    document.querySelector('#gate-title').textContent = 'LINE で開いてください';
    document.querySelector('#gate-text').textContent = 'ご予約確定のご連絡や、ご予約の変更・キャンセルを LINE で行うため、日曜日のご予約は LINE からお願いしております。下のボタンから LINE で開き、当院の LINE 公式アカウントを友だち追加してください。';
    document.querySelector('#gate-add').hidden = true;
    document.querySelector('#gate-again').hidden = true;
    document.querySelector('#gate-open').hidden = false;
    document.querySelector('#gate-note').hidden = true;
  } else if (mode === 'friend') {
    document.querySelector('#gate-again').hidden = false;
  }
};
/** 友だち追加しているか（確かめられなければ null） */
async function friendOk() {
  try {
    return (await window.liff.getFriendship()).friendFlag === true;
  } catch (_) {
    return null;
  }
}
async function startLine() {
  const id = document.querySelector('script[data-liff]')?.dataset.liff || '';
  if (!id) return;
  if (!window.liff) { showGate('open'); return; }
  try {
    await window.liff.init({ liffId: id });
    if (!window.liff.isInClient() && !window.liff.isLoggedIn()) { showGate('open'); return; }
    idToken = window.liff.getIDToken() || '';
  } catch (_) {
    idToken = '';
  }
  if (!idToken) { showGate('open'); return; }
  document.querySelector('#line-note').hidden = false;
  // LINE の表示名は入力してもらわず、LINE から読む（予約のメモに残す）
  try {
    lineName = (await window.liff.getProfile()).displayName || '';
  } catch (_) {
    lineName = '';
  }
  // 友だち追加がまだなら、追加してもらってから予約の画面へ（戻ってきたら確かめ直す）
  const friend = await friendOk();
  // 友だちかどうかを LINE で確かめられないときは、予約の画面の上に友だち追加のお願いを小さく出す（送るときにサーバーでも確かめる）
  if (friend === null) {
    const note = document.querySelector('#friend-note');
    if (note) note.hidden = false;
  }
  if (friend === false) {
    showGate('friend');
    const recheck = async () => { if ((await friendOk()) !== false) { showGate(''); syncInputs(); } };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
    window.addEventListener('focus', recheck);
    document.querySelector('#gate-again').addEventListener('click', recheck);
    return;
  }
  showGate('');
}
startLine();

// 分類を選ぶと、その分類の施術だけを出す（ほかの分類で選んでいた施術は外す）
function syncCats(en) {
  const cats = R(en, 'cats');
  if (!cats) return;
  const cat = ev(en, 'cat');
  const sub = R(en, 'sub');
  sub.hidden = !cat;
  R(en, 'cat-note').hidden = !!cat;
  if (cat) {
    R(en, 'sub-title').textContent = `「${cat}」の施術を選んでください`;
    // 囲みの上の三角を、押した分類の下に合わせる（どこから開いたか分かるように）
    const lab = inputs(en, 'cat').find((x) => x.checked)?.closest('label');
    if (lab) sub.style.setProperty('--arrow', `${lab.offsetLeft - sub.offsetLeft + lab.offsetWidth / 2 - 8}px`);
  }
  R(en, 'kinds').querySelectorAll('label[data-cat]').forEach((l) => {
    const show = l.dataset.cat === cat;
    l.hidden = !show;
    const input = l.querySelector('input');
    if (!show && input.checked) input.checked = false;
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (form.dataset.preview) { showErrors(['プレビューのため、予約は送れません']); return; }
  const fd = new FormData(form);
  const body = Object.fromEntries(['clinicVisit', 'insuranceHistory', 'referrer', 'name', 'kana', 'birthDate', 'phone', 'email', 'notes', 'website'].map((k) => [k, String(fd.get(k) || '')]));
  body.lineName = lineName;
  body.agree = !!fd.get('agree');
  const list = entries();
  // 初診の方の「当日施術の希望」は、施術ごとの希望から（1つでも有なら有）
  body.sameDayTreatment = list.some((en) => sameDay(en) === '有') ? '有' : '無';
  if (singleMode()) {
    // 施術が1つで当日施術あり：今までどおりの形で送る
    const en = list[0];
    const item = itemOf(en);
    const eb = entryBody(en);
    Object.assign(body, eb, { visit: visitOf(en), anesthesiaType: eb.anesthesiaType || '' });
    if (item) {
      body.item = item.value.slice(2);
      body.kind = '';
      body.anesthesia = '';
      body.color = '';
      body.rects = [];
    } else {
      body.item = '';
    }
  } else {
    body.entries = list.map(entryBody);
  }
  body.date = selected;
  body.time = String(fd.get('time') || '');
  if (idToken) body.idToken = idToken;
  const local = [];
  if (!body.clinicVisit) local.push(LABELS.clinicVisit);
  else if (body.clinicVisit === 'initial' && !body.insuranceHistory) local.push(LABELS.initialInfo);
  list.forEach((en, i) => {
    const head = list.length > 1 ? `施術${i + 1}：` : '';
    const item = itemOf(en);
    if (!kindOf(en)) { local.push(head + LABELS.kind); return; }
    if (!sameDay(en)) { local.push(head + LABELS.sameDay); return; }
    if (sameDay(en) === '有' && body.clinicVisit === 'returning' && !ev(en, 'status')) { local.push(head + LABELS.status); return; }
    if (en.dataset.ok !== '1') { local.push(head + (R(en, 'visit-note').textContent || LABELS.visit)); return; }
    if (sameDay(en) === '無' || !body.clinicVisit) return;
    if (!item && !rects(en).length) local.push(head + LABELS.area);
    else if (item && !entryReady(en)) local.push(head + (item.dataset.flow === '1' ? LABELS.flow : item.dataset.needle === '1' ? (needleTotal(en) > 0 ? LABELS.needle : LABELS.needleCount) : item.dataset.cream === '1' && !ev(en, 'cream') ? LABELS.cream : item.dataset.count === '1' ? LABELS.count : LABELS.parts));
  });
  if (!body.date || !body.time) local.push(LABELS.slot);
  if (!body.name.trim()) local.push(LABELS.name);
  if (!body.kana.trim()) local.push(LABELS.kana);
  if (!body.birthDate) local.push(LABELS.birthDate);
  if (!/^0\d{9,10}$/.test(body.phone.replace(/[-ー\s]/g, ''))) local.push(LABELS.phone);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) local.push(LABELS.email);
  if (!body.agree) local.push(LABELS.agree);
  // 必須の項目が足りなければ送らない（院長 11/20）
  if (local.length) { showErrors(local, '入力されていない必須項目があります'); return; }
  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = '送信中…';
  try {
    const res = await fetch('./api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      form.hidden = true;
      document.querySelector('#done').hidden = false;
      // ご来院前のお願い：選んだ日曜メニューの案内（タトゥー・アートメイクは産毛の案内）
      const before = document.querySelector('#done-before');
      const notes = [...new Set(list.map((en) => (isRemoval(en) ? before?.dataset.shave || '' : itemOf(en)?.dataset.note || '')).filter(Boolean))];
      if (before) {
        before.textContent = notes.join('\n');
        before.hidden = notes.length === 0;
      }
      document.querySelector('#done-when').textContent = `${ja(body.date)} ${body.time}〜${data.end || ''}（${data.duration || ''}）。${body.time} にご来院ください`;
      document.querySelector('#done-mail').textContent = data.lined
        ? 'LINE に、ご予約の内容をお送りしました。'
        : data.mailed
          ? 'ご入力のメールアドレスに、ご予約の内容をお送りしました。'
          : 'ご予約の内容をお送りできませんでした。ご予約は承っております。';
      if (data.questionnaire) {
        document.querySelector('#done-q-link').href = data.questionnaire;
        document.querySelector('#done-q').hidden = false;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (data.error === 'slot_taken') {
      await load();
      showErrors(['選んだ時刻は、先にご予約が入りました。別の日時をお選びください']);
    } else if (data.error === 'invalid') {
      showErrors((data.fields || []).map((f) => LABELS[f]).filter(Boolean), '入力されていない必須項目があります');
    } else if (data.error === 'rate_limited') {
      showErrors(['送信が続いたため、しばらく受け付けられません。時間をおいてお試しください']);
    } else if (data.error === 'contact_us') {
      showErrors(['ご予約を受け付けられませんでした。お手数ですが、当院の LINE からご連絡ください']);
    } else if (data.error === 'friend_required') {
      showErrors(['当院の LINE 公式アカウントの友だち追加をお願いします。追加してから、もう一度「この内容で予約する」を押してください']);
    } else if (data.error === 'line_required') {
      showErrors(['日曜日のご予約は LINE からお願いしております。LINE で開き直してください']);
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
addEntry();
