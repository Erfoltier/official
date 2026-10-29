const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const clean = value => String(value ?? '').trim();

export function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

// 受け付ける曜日（0=日〜6=土）は 設定 → 院の情報 の「LINE の予約申請フォーム」から。未設定なら毎日
export function isAllowedClinicDate(value, specialDates = [], weekdays = [0, 1, 2, 3, 4, 5, 6]) {
  const date = parseIsoDate(value);
  return Boolean(date) && (weekdays.includes(date.getUTCDay()) || specialDates.includes(value));
}

/** 「水曜日」「月・木曜日」のような、受け付ける曜日の言い方 */
export function weekdayLabel(weekdays = [0, 1, 2, 3, 4, 5, 6]) {
  if (weekdays.length === 7) return '';
  if (!weekdays.length) return '';
  return `${weekdays.map(d => WEEKDAYS[d]).join('・')}曜日`;
}

export function formatJapaneseDate(value) {
  const date = parseIsoDate(value);
  if (!date) return '';
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${WEEKDAYS[date.getUTCDay()]}）`;
}

export function validateIntake(data, { specialDates = [], weekdays = [0, 1, 2, 3, 4, 5, 6], today = new Date() } = {}) {
  const errors = [];
  const todayIso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
  if (data.privacyConsent !== 'agreed') errors.push('個人情報の取扱いへの同意が必要です');
  if (!['initial', 'returning'].includes(data.visitType)) errors.push('受診区分を選択してください');
  if (!data.preferredDate) errors.push('希望予約日を選択してください');
  else if (data.preferredDate < todayIso) errors.push('本日以降の希望予約日を選択してください');
  else if (!isAllowedClinicDate(data.preferredDate, specialDates, weekdays)) errors.push(weekdays.length && weekdays.length < 7 ? `${weekdayLabel(weekdays)}または特別診療日を選択してください` : '受付日を選択してください');
  if (!data.timePreference) errors.push('希望時間帯を選択してください');
  if (!clean(data.name)) errors.push('漢字氏名を入力してください');
  if (!clean(data.kana)) errors.push('カナ氏名を入力してください');
  if (!parseIsoDate(data.birthDate) || data.birthDate >= todayIso) errors.push('正しい生年月日を入力してください');
  if (data.visitType === 'initial' && !/^0\d{9,10}$/.test(clean(data.phone).replace(/[-ー\s]/g, ''))) errors.push('電話番号を半角数字で入力してください');
  if (data.visitType === 'initial' && !data.insuranceHistory) errors.push('保険通院歴を選択してください');
  if (data.visitType === 'initial' && !data.sameDayTreatment) errors.push('当日施術の希望を選択してください');
  if (data.visitType === 'initial' && !clean(data.initialTreatment)) errors.push('希望治療メニューまたはお悩みを入力してください');
  if (data.visitType === 'returning' && !clean(data.returningTreatment)) errors.push('希望治療メニューを入力してください');
  if (data.visitType === 'returning' && !clean(data.returningBodyArea)) errors.push('希望部位を入力してください');
  if (data.visitType === 'returning' && !data.returningSameDayTreatment) errors.push('当日施術の希望を選択してください');
  if (data.visitType === 'returning' && !data.treatmentStatus) errors.push('今回の治療内容を選択してください');
  return errors;
}

// clinic は 設定 → 院の情報 から（department：診療科の名前、name：院名）
export function buildLineMessage(data, clinic = {}) {
  const initial = data.visitType === 'initial';
  const dept = clean(clinic.department);
  const lines = [
    `【${dept ? `${dept}・` : ''}${initial ? '初診' : '再診'}予約申請】`, '',
    `受診区分：${initial ? '①初診' : '②再診'}`,
    `希望予約日時：${formatJapaneseDate(data.preferredDate)}`,
    `希望時間帯：${clean(data.timePreference)}${clean(data.timeNote) ? `（${clean(data.timeNote)}）` : ''}`, '',
    `漢字氏名：${clean(data.name)}`, `カナ氏名：${clean(data.kana)}`,
    `生年月日：${formatJapaneseDate(data.birthDate).replace(/（.）$/, '')}`,
  ];
  if (clean(data.gender)) lines.push(`性別：${clean(data.gender)}`);
  if (initial) {
    lines.push(`電話番号：${clean(data.phone)}`, `${clean(clinic.name) || '当院'}保険通院歴：${clean(data.insuranceHistory)}`, '',
      `当日施術希望：${clean(data.sameDayTreatment)}`,
      `希望治療メニューまたはお悩み：${clean(data.initialTreatment)}`,
      `具体的な部位・個数：${clean(data.initialBodyArea) || '記載なし'}`,
      `その他ご相談事項：${clean(data.initialNotes) || 'なし'}`,
      `紹介者名：${clean(data.referrer) || 'なし'}`);
  } else {
    lines.push('', `当日施術希望：${clean(data.returningSameDayTreatment)}`,
      `希望治療メニュー：${clean(data.returningTreatment)}`,
      `希望部位：${clean(data.returningBodyArea)}`,
      `今回の内容：${clean(data.treatmentStatus)}`,
      `その他ご相談事項：${clean(data.returningNotes) || 'なし'}`);
  }
  return lines.join('\n');
}
