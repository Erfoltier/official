import { buildLineMessage, formatJapaneseDate, isAllowedClinicDate, validateIntake } from './form-model.js?v=20261116-2';

const form = document.querySelector('#intake-form');
const preferredDate = document.querySelector('#preferred-date');
const grid = document.querySelector('#calendar-grid');
const title = document.querySelector('#calendar-title');
const selectedLabel = document.querySelector('#selected-date');
const errorSummary = document.querySelector('#error-summary');
const confirmDialog = document.querySelector('#confirm-dialog');
const completeDialog = document.querySelector('#complete-dialog');
const privacyDialog = document.querySelector('#privacy-dialog');
const privacyConsent = document.querySelector('[name="privacyConsent"]');
const privacyContinueButton = document.querySelector('#privacy-continue-button');
const preview = document.querySelector('#message-preview');
const submitButton = document.querySelector('#submit-button');
const sendButton = document.querySelector('#send-button');
const confirmTitle = document.querySelector('#confirm-title');
const confirmNote = document.querySelector('#confirm-note');
const birthDate = document.querySelector('#birth-date');
const birthManual = document.querySelector('#birth-date-manual');
const birthPicker = document.querySelector('#birth-date-picker');
const today = new Date();
const officialAccountId = '@609lberb';
let monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let specialDates = [];
let weekdays = [0, 1, 2, 3, 4, 5, 6];
/** カウンセリングで選べる枠（日付 => 開始時刻）。intake-config.php が、開けた受付枠のうち空いている時間だけを返す */
let counselingSlots = {};
const isCounseling = () => form.elements.visitType.value === 'counseling';
const validationOptions = () => ({ specialDates, weekdays, today, counselingSlots });
const dateAllowed = iso => (isCounseling() ? (counselingSlots[iso] || []).length > 0 : isAllowedClinicDate(iso, specialDates, weekdays));
let clinic = {};
let liffReady = false;
let liffInitError = null;
let liffContextType = '';
let chatPermissionState = 'unknown';
const diagnosticSessionId = crypto.randomUUID();

const isoLocal = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const formData = () => Object.fromEntries(new FormData(form).entries());
const officialAccountDraftUrl = text => `https://line.me/R/oaMessage/${encodeURIComponent(officialAccountId)}/?${encodeURIComponent(text)}`;
const diagnosticEnvironment = () => ({
  contextType: liffContextType,
  permissionState: chatPermissionState,
  lineVersion: window.liff?.getLineVersion?.() || '',
  os: window.liff?.getOS?.() || '',
  sdkVersion: window.liff?.getVersion?.() || '',
  isInClient: Boolean(window.liff?.isInClient?.()),
  isLoggedIn: Boolean(window.liff?.isLoggedIn?.()),
  apiAvailable: typeof window.liff?.sendMessages === 'function',
});

async function reportDiagnostic(stage, details = {}, requestId = '') {
  const idToken = window.liff?.getIDToken?.() || '';
  if (!idToken) return;
  try {
    await fetch('../liff-diagnostic-v1.php', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({idToken, sessionId:diagnosticSessionId, stage, requestId, details:{...diagnosticEnvironment(), ...details}}),
      cache: 'no-store',
      keepalive: true,
    });
  } catch (_) {
    // Diagnostics must never block reservation submission.
  }
}
async function saveReservationIntake() {
  if (!window.liff?.isLoggedIn()) throw Object.assign(new Error('LINE login required'), { code: 'LINE_LOGIN_REQUIRED' });
  const idToken = window.liff.getIDToken();
  if (!idToken) throw Object.assign(new Error('LINE identity unavailable'), { code: 'LINE_IDENTITY_UNAVAILABLE' });
  const response = await fetch('../intake-submit-v1.php', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({idToken, form: formData(), message: preview.textContent}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || 'reservation save failed'), { code: `INTAKE_SAVE_${response.status}` });
  return result;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForLineReceipt(token, timeoutMilliseconds = 12000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    await wait(1000);
    try {
      const response = await fetch('../intake-status-v1.php', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({token}),
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.lineMessageReceived === true) return true;
    } catch (_) {
      // A transient status error is retried until the deadline.
    }
  }
  return false;
}

async function sendAsLineUser(text, followupToken, requestId) {
  if (!liffReady) throw Object.assign(new Error('LIFF chat send is unavailable'), {code:'LIFF_SEND_UNAVAILABLE'});
  const startedAt = performance.now();
  await reportDiagnostic('before_send', {result:'started'}, requestId);
  const sendResult = window.liff.sendMessages([{type:'text', text}])
    .then(() => {
      void reportDiagnostic('sdk_resolved', {result:'resolved', elapsedMs:performance.now()-startedAt}, requestId);
      return {sent:true};
    })
    .catch(error => {
      void reportDiagnostic('sdk_rejected', {result:'rejected', errorCode:String(error?.code||''), errorMessage:String(error?.message||''), elapsedMs:performance.now()-startedAt}, requestId);
      return {sent:false, error};
    });
  const receiptResult = waitForLineReceipt(followupToken, 15000).then(received => {
    if (received) void reportDiagnostic('webhook_received', {result:'received', elapsedMs:performance.now()-startedAt}, requestId);
    return {received};
  });
  const outcome = await Promise.race([sendResult, receiptResult]);
  if (outcome.sent === true || outcome.received === true) {
    await reportDiagnostic('send_completed', {result:outcome.sent===true?'sdk':'webhook', elapsedMs:performance.now()-startedAt}, requestId);
    return true;
  }
  if (outcome.error) throw outcome.error;
  await reportDiagnostic('send_timeout', {result:'timeout', elapsedMs:performance.now()-startedAt}, requestId);
  throw Object.assign(new Error('LINE send result timed out'), {code:'LIFF_SEND_TIMEOUT'});
}
const refreshSubmitState = () => { submitButton.disabled = validateIntake(formData(), validationOptions()).length > 0; };

function renderCalendar() {
  title.textContent = `${monthCursor.getFullYear()}年 ${monthCursor.getMonth() + 1}月`;
  grid.replaceChildren();
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1).getDay();
  const days = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
  for (let index = 0; index < firstDay; index += 1) grid.append(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day);
    const iso = isoLocal(date);
    const button = document.createElement('button');
    const allowed = date >= new Date(today.getFullYear(), today.getMonth(), today.getDate()) && dateAllowed(iso);
    button.type = 'button';
    button.textContent = String(day);
    button.disabled = !allowed;
    button.className = preferredDate.value === iso ? 'selected' : '';
    button.setAttribute('aria-label', `${formatJapaneseDate(iso)}${allowed ? '' : ' 選択不可'}`);
    if (specialDates.includes(iso) && !isCounseling()) button.dataset.special = 'true';
    button.addEventListener('click', () => {
      preferredDate.value = iso;
      selectedLabel.textContent = `希望日：${formatJapaneseDate(iso)}${specialDates.includes(iso) && !isCounseling() ? ' 特別診療日' : ''}`;
      renderCalendar();
      renderTimes();
      refreshSubmitState();
    });
    grid.append(button);
  }
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  document.querySelector('#prev-month').disabled = monthCursor <= currentMonth;
  document.querySelector('#next-month').disabled = monthCursor >= new Date(today.getFullYear(), today.getMonth() + 5, 1);
}

/** 希望時間：カウンセリングは選んだ日の空いている時間（15分ごと）、それ以外は午前・午後などの時間帯 */
function renderTimes() {
  const counseling = isCounseling();
  const pills = document.querySelector('#time-pills');
  const noteField = document.querySelector('#time-note-field');
  const times = document.querySelector('#counseling-times');
  pills.hidden = counseling;
  noteField.hidden = counseling;
  pills.querySelectorAll('input').forEach(control => { control.disabled = counseling; });
  noteField.querySelector('input').disabled = counseling;
  times.hidden = !counseling;
  document.querySelector('#time-legend').textContent = counseling ? '希望時間（1枠15分）' : '希望時間帯';
  const current = counseling ? form.querySelector('#counseling-times input:checked')?.value : '';
  times.replaceChildren();
  if (!counseling) return;
  const slots = counselingSlots[preferredDate.value] || [];
  if (!slots.length) {
    const hint = document.createElement('p');
    hint.className = 'selected-date';
    hint.textContent = '日付を選ぶと、空いている時間が表示されます';
    times.append(hint);
    return;
  }
  for (const time of slots) {
    const label = document.createElement('label');
    label.className = 'pill';
    const input = document.createElement('input');
    Object.assign(input, { type: 'radio', name: 'timePreference', value: time, required: true, checked: time === current });
    const span = document.createElement('span');
    span.textContent = time;
    label.append(input, span);
    times.append(label);
  }
}

/** 区分を変えたときに、選べない日になった希望日を外す。カウンセリングは最初の枠の月を出す */
function refreshDateMode() {
  const counseling = isCounseling();
  document.querySelector('#date-note').textContent = counseling
    ? '選択できる日時だけがご予約いただける枠です（1枠15分）。'
    : '選択できる日だけが診療日です　特別診療日は約2か月先まで表示されます。';
  if (preferredDate.value && !dateAllowed(preferredDate.value)) {
    preferredDate.value = '';
    selectedLabel.textContent = '希望日を選択してください';
  }
  const first = Object.keys(counselingSlots).sort()[0];
  if (counseling && first && !preferredDate.value) {
    const [y, m] = first.split('-').map(Number);
    monthCursor = new Date(y, m - 1, 1);
  }
  renderCalendar();
  renderTimes();
}

function addMonths(amount) {
  monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + amount, 1);
  renderCalendar();
}

/** カウンセリング（ゼオスキン）の区分：設定で有効なときだけ出す。?type=counseling（LIFF の liff.state 経由も）で最初から選ぶ */
function applyCounseling(enabled) {
  const choice = document.querySelector('#visit-counseling');
  const radio = choice.querySelector('input');
  choice.hidden = !enabled;
  radio.disabled = !enabled;
  if (!enabled) return;
  const params = new URLSearchParams(location.search);
  const state = params.get('liff.state');
  const type = params.get('type') || (state ? new URLSearchParams(state.replace(/^[^?]*\?/, '')).get('type') : null);
  if (type === 'counseling') {
    radio.checked = true;
    applyVisitType();
  }
}

function applyVisitType() {
  const visitType = form.elements.visitType.value;
  const initialSection = document.querySelector('#initial-details');
  const returningSection = document.querySelector('#returning-details');
  const counselingSection = document.querySelector('#counseling-details');
  const setSection = (section, active) => {
    section.hidden = !active;
    section.querySelectorAll('input,textarea').forEach(control => { control.disabled = !active; });
  };
  setSection(initialSection, visitType === 'initial');
  setSection(returningSection, visitType === 'returning');
  setSection(counselingSection, visitType === 'counseling');
  // カウンセリングのお客様向けには「患者」「診察」を使わない
  document.querySelector('#person-title').textContent = visitType === 'counseling' ? 'お客さま情報' : '患者さま情報';
  document.querySelector('#person-note').textContent = visitType === 'counseling' ? 'お名前と生年月日をご入力ください' : '診察券と同じ内容をご入力ください';
  refreshDateMode();
  refreshSubmitState();
}

function refreshPrivacyConsentState() {
  privacyContinueButton.disabled = !privacyConsent.checked;
  refreshSubmitState();
}

function parseManualBirthDate(value) {
  const normalized = String(value).normalize('NFKC').trim();
  const separated = normalized.match(/^(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})$/);
  const compact = normalized.replace(/\D/g, '');
  const parts = separated ? separated.slice(1).map(Number) : compact.length === 8 ? [Number(compact.slice(0,4)), Number(compact.slice(4,6)), Number(compact.slice(6,8))] : null;
  if (!parts) return '';
  const [year, month, day] = parts;
  const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const parsed = new Date(`${iso}T00:00:00`);
  return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day ? iso : '';
}

function setBirthDate(value, source) {
  birthDate.value = value;
  if (value) {
    document.querySelector('#birth-date-result').textContent = `生年月日：${formatJapaneseDate(value).replace(/（.）$/, '')}`;
    if (source !== 'calendar') birthPicker.value = value;
    if (source !== 'manual') birthManual.value = value.replaceAll('-', ' / ');
  } else {
    document.querySelector('#birth-date-result').textContent = '正しい生年月日を入力してください';
  }
  refreshSubmitState();
}

function openBirthCalendar() {
  birthPicker.focus({preventScroll:true});
  if (typeof birthPicker.showPicker !== 'function') return;
  try {
    birthPicker.showPicker();
  } catch (_) {
    // Browsers that restrict programmatic pickers retain the focused native date control.
  }
}

/** 院名・診療科・受付の案内・プライバシーポリシーを、設定 → 院の情報 の内容で画面に入れる */
function applyClinic(c) {
  const dept = c.department || '';
  document.querySelectorAll('[data-clinic]').forEach(el => {
    const key = el.dataset.clinic;
    const value = key === 'department' ? (dept || el.dataset.fallback || '') : (c[key] || el.dataset.fallback || '');
    if (key === 'intakeHours') {
      el.replaceChildren(...value.split('\n').flatMap((line, i) => (i ? [document.createElement('br'), line] : [line])));
    } else {
      el.textContent = value;
    }
  });
  document.querySelectorAll('[data-if-department]').forEach(el => { el.hidden = !dept; });
  const logo = document.querySelector('.clinic-logo');
  if (logo) logo.setAttribute('aria-label', [c.publicName, c.publicNameEn].filter(Boolean).join(' '));
  const privacy = document.getElementById('privacy-link');
  if (privacy) {
    if (c.privacyUrl) privacy.href = c.privacyUrl;
    privacy.closest('p').hidden = !c.privacyUrl;
  }
  document.title = `${dept ? `${dept} ` : ''}予約申請`;
}

async function reloadCounselingSlots() {
  try {
    const response = await fetch('../intake-config.php', { cache: 'no-store' });
    const config = response.ok ? await response.json() : {};
    counselingSlots = config.counselingSlots && typeof config.counselingSlots === 'object' ? config.counselingSlots : {};
  } catch (_) { /* keep the slots we have */ }
  refreshDateMode();
  refreshSubmitState();
}

async function initialize() {
  let config = {};
  try {
    const response = await fetch('../intake-config.php', { cache: 'no-store' });
    if (response.ok) {
      config = await response.json();
      specialDates = Array.isArray(config.specialDates) ? config.specialDates : [];
      if (Array.isArray(config.weekdays)) weekdays = config.weekdays;
      clinic = config.clinic || {};
      counselingSlots = config.counselingSlots && typeof config.counselingSlots === 'object' ? config.counselingSlots : {};
      applyClinic(clinic);
      applyCounseling(config.counseling === true);
    }
  } catch (_) {
    // Static fallback is loaded below.
  }
  if (!specialDates.length) {
    try {
      const fallback = await fetch('./special-clinic-days.json', { cache: 'no-store' });
      const schedule = fallback.ok ? await fallback.json() : {};
      specialDates = Array.isArray(schedule.dates) ? schedule.dates : [];
    } catch (_) {
      specialDates = [];
    }
  }
  if (config.liffId && window.liff) {
    try {
      await window.liff.init({ liffId: config.liffId });
      if (!window.liff.isLoggedIn()) {
        window.liff.login({ redirectUri: location.href });
        return;
      }
      liffContextType = window.liff.getContext()?.type || '';
      const permission = await window.liff.permission.query('chat_message.write');
      chatPermissionState = permission?.state || 'unknown';
      liffReady = window.liff.isInClient()
        && ['utou', 'group', 'room'].includes(liffContextType)
        && chatPermissionState === 'granted'
        && typeof window.liff.sendMessages === 'function';
      await reportDiagnostic('initialized', {result:liffReady?'send_ready':'send_unavailable'});
    } catch (error) {
      liffInitError = error;
      liffReady = false;
    }
  }
  renderCalendar();
  refreshSubmitState();
}

form.addEventListener('input', refreshSubmitState);
form.addEventListener('change', event => {
  if (event.target.name === 'visitType') applyVisitType();
  refreshSubmitState();
});
privacyConsent.addEventListener('change', refreshPrivacyConsentState);
privacyContinueButton.addEventListener('click', () => {
  if (!privacyConsent.checked) return;
  privacyDialog.close();
  refreshSubmitState();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const data = formData();
  const errors = validateIntake(data, validationOptions());
  if (errors.length) {
    refreshSubmitState();
    errorSummary.hidden = false;
    errorSummary.innerHTML = `<strong>入力内容をご確認ください</strong><ul>${errors.map(error => `<li>${error}</li>`).join('')}</ul>`;
    errorSummary.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  errorSummary.hidden = true;
  preview.textContent = buildLineMessage(data, clinic);
  if (liffReady) {
    confirmTitle.textContent = 'この内容をLINEへ送信します';
    confirmNote.textContent = '送信すると、この内容が患者様からのメッセージとしてLINEトークへ投稿されます。';
    sendButton.textContent = '入力フォーム内容をLINEで送信';
  } else if (window.liff?.isInClient()) {
    confirmTitle.textContent = 'この内容をLINEトークへ入力します';
    confirmNote.textContent = '「LINEトークに入力」ボタンを押すと、トーク画面に戻り、自動でメッセージが入力されます。内容をご確認の上、LINE側の送信ボタンを押してください。';
    sendButton.textContent = 'LINEトークに入力';
  } else {
    confirmTitle.textContent = 'この内容をコピーします';
    confirmNote.textContent = 'コピーした文章をLINEに貼り付けてください。';
    sendButton.textContent = '文章をコピー';
  }
  confirmDialog.showModal();
});

document.querySelector('#prev-month').addEventListener('click', () => addMonths(-1));
document.querySelector('#next-month').addEventListener('click', () => addMonths(1));
document.querySelectorAll('[data-birth-mode]').forEach(button => button.addEventListener('click', () => {
  const mode = button.dataset.birthMode;
  document.querySelectorAll('[data-birth-mode]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelector('#birth-manual-wrap').hidden = mode !== 'manual';
  document.querySelector('#birth-calendar-wrap').hidden = mode !== 'calendar';
  if (mode === 'manual') birthManual.focus();
  else openBirthCalendar();
}));
birthManual.addEventListener('input', () => setBirthDate(parseManualBirthDate(birthManual.value), 'manual'));
birthPicker.max = isoLocal(today);
birthPicker.addEventListener('change', () => setBirthDate(birthPicker.value, 'calendar'));
document.querySelector('#back-button').addEventListener('click', () => confirmDialog.close());
document.querySelector('#send-button').addEventListener('click', async event => {
  const button = event.currentTarget;
  const errors = validateIntake(formData(), validationOptions());
  if (errors.length) { confirmDialog.close(); refreshSubmitState(); return; }
  button.disabled = true;
  button.textContent = '送信中…';
  try {
    if (window.liff?.isInClient()) {
      const saved = await saveReservationIntake();
      sessionStorage.setItem('intakeRequestId', saved.requestId);
      const lineMessage = `${preview.textContent}\n\n予約申請ID：${saved.requestId}`;
      if (liffReady) {
        await sendAsLineUser(lineMessage, saved.followupToken, saved.requestId);
        confirmDialog.close();
        document.querySelector('#complete-title').textContent = 'LINEへ送信しました';
        document.querySelector('#complete-message').textContent = '予約申請を送信しました。自動でLINEトーク画面に戻ります。お待ちください。';
        completeDialog.showModal();
        window.setTimeout(() => {
          try { window.liff.closeWindow(); } catch (_) { /* The close button remains available. */ }
        }, 1200);
        return;
      }
      window.location.href = officialAccountDraftUrl(lineMessage);
      return;
    } else {
      await navigator.clipboard.writeText(preview.textContent);
      confirmDialog.close();
      document.querySelector('#complete-title').textContent = '文章をコピーしました';
      document.querySelector('#complete-message').textContent = 'コピーした文章をLINEに貼り付けてください。';
      completeDialog.showModal();
    }
  } catch (error) {
    if (error?.message === 'counseling_slot_unavailable') {
      // 送るあいだに枠が埋まった：空きを読み直して、時間を選び直してもらう
      confirmDialog.close();
      await reloadCounselingSlots();
      errorSummary.hidden = false;
      errorSummary.innerHTML = '<strong>選んだ時間はご予約できなくなりました</strong><ul><li>お手数ですが、別の日時をお選びください</li></ul>';
      errorSummary.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const code = error?.code || liffInitError?.code || 'UNKNOWN';
    const context = !window.liff
      ? 'LINE SDKを読み込めませんでした'
      : !window.liff.isInClient()
        ? 'LINE内のLIFF画面として開かれていません'
        : !window.liff.isLoggedIn()
          ? 'LINEログインが完了していません'
          : typeof window.liff.sendMessages !== 'function'
            ? `この画面ではメッセージ送信機能を利用できません（権限：${chatPermissionState}／起動元：${liffContextType || 'なし'}）`
            : 'LINE側がメッセージ送信を拒否しました';
    confirmDialog.close();
    document.querySelector('#complete-title').textContent = 'LINEトークを開けませんでした';
    document.querySelector('#complete-message').textContent = `${context}（エラーコード：${code}）。入力内容は失われていません。表示された文章をコピーして送信してください。`;
    completeDialog.showModal();
  } finally {
    button.disabled = false;
    button.textContent = liffReady ? '入力フォーム内容をLINEで送信' : window.liff?.isInClient() ? 'LINEトークに入力' : '文章をコピー';
  }
});
document.querySelector('#close-button').addEventListener('click', () => liffReady ? window.liff.closeWindow() : completeDialog.close());

submitButton.disabled = true;
applyVisitType();
// Display consent before network-dependent LINE initialization can delay it.
if (!privacyConsent.checked) privacyDialog.showModal();
initialize();
