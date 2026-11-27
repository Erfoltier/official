/*
 * 予約のページの相談内容から、保険診療の内容・保険適用の可能性・子連れの案内を出す（院長 11/28）。
 * 言葉と文はサーバー（php/lib/InsuranceGuard.php）の1か所にあり、ページはそれを受け取って同じ判定をする。予約は止めない。
 * 使い方：insuranceGuard.attach(rules, 読む欄を返す関数, 案内を入れる要素, 入力を見張る要素)
 */
(function () {
  function check(rules, text) {
    const t = String(text || '').normalize('NFKC');
    let keys = rules.filter((r) => r.all.length > 0 && r.all.every((p) => new RegExp(p, 'u').test(t)) && !r.none.some((p) => new RegExp(p, 'u').test(t))).map((r) => r.key);
    if (keys.includes('insurance') || keys.includes('acne')) keys = keys.filter((k) => k !== 'maybe');
    return keys;
  }
  function attach(rules, fieldsOf, box, root) {
    if (!Array.isArray(rules) || !box) return;
    const update = () => {
      const keys = check(rules, fieldsOf().filter(Boolean).map((f) => f.value).join('\n'));
      box.replaceChildren(...rules.filter((r) => keys.includes(r.key)).map((r) => {
        const p = document.createElement('p');
        p.textContent = r.text;
        return p;
      }));
      box.hidden = keys.length === 0;
    };
    (root || document).addEventListener('input', update);
    update();
  }
  window.insuranceGuard = { check, attach };
})();
