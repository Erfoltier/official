<?php
/**
 * 患者向けページ（問診票・LINE の問診票）の見た目。LINE の予約申請フォームと同じ色・石畳の背景・院のロゴにそろえる。
 * 画像は assets/（stone.webp・logo.webp）。$base はページから assets/ までの相対パス
 */
declare(strict_types=1);

function monshin_style(string $base): string
{
    $bg = htmlspecialchars($base . 'assets/stone.webp', ENT_QUOTES, 'UTF-8');
    return <<<CSS
:root{--ink:#403a35;--muted:#786f67;--line:#d8cdc1;--accent:#b39378;--green:#75685d;--danger:#9b4c49}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font-family:"Yu Gothic UI","Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.7;font-size:16px;min-height:100vh;background:linear-gradient(145deg,rgba(241,235,226,.84),rgba(202,189,174,.78)) fixed,url("{$bg}") center top/900px auto fixed #e8e0d5}
main{width:min(100%,680px);margin:auto;padding:20px 16px 56px}
.clinic-header{text-align:center;padding:10px 8px 20px}
.clinic-logo{display:flex;align-items:center;justify-content:center;gap:clamp(10px,3vw,16px);margin:0 auto 16px}
.clinic-logo img{width:auto;height:clamp(58px,16vw,76px);object-fit:contain;flex:none}
.clinic-logo span{display:flex;flex-direction:column;align-items:flex-start;color:#5d4b44;min-width:0;line-height:1.45}
.clinic-logo b{font-family:"Yu Mincho","Hiragino Mincho ProN",serif;font-size:clamp(1.05rem,5vw,1.4rem);letter-spacing:.04em;white-space:nowrap}
.clinic-logo small{font-family:Georgia,serif;font-size:clamp(.78rem,3.4vw,.98rem);letter-spacing:.03em;white-space:nowrap}
.eyebrow{color:#8a7869;font-size:.68rem;letter-spacing:.22em;font-weight:700;margin:0 0 5px}
.clinic-header h1{font-family:"Yu Mincho","Hiragino Mincho ProN",serif;font-size:1.65rem;margin:0 0 8px}
.intro,.notice{display:block;white-space:pre-wrap;background:linear-gradient(120deg,rgba(255,250,242,.96),rgba(235,222,208,.96));border-left:4px solid var(--accent);border-radius:10px;padding:13px 15px;margin:0 0 14px;font-size:.88rem;color:#6c6459;box-shadow:0 8px 28px rgba(84,70,58,.08)}
.card{background:linear-gradient(145deg,rgba(255,254,251,.97),rgba(239,231,221,.94));border:1px solid rgba(126,105,87,.18);border-radius:18px;padding:18px 20px;margin:12px 0;box-shadow:0 10px 30px rgba(69,56,47,.10)}
.q,legend.q{display:block;font-size:.9rem;font-weight:700;margin:0 0 8px;padding:0}
fieldset{border:0;margin:0;padding:0;min-width:0}
.req{font-style:normal;font-size:.62rem;color:#fff;background:#a8866f;border-radius:4px;padding:2px 5px;margin-left:6px;vertical-align:2px;font-weight:700}
input[type=text],input[type=tel],input[type=email],input[type=date],textarea{width:100%;border:1px solid var(--line);background:rgba(255,254,251,.78);border-radius:10px;padding:12px 13px;font:inherit;font-size:.95rem;color:var(--ink)}
textarea{min-height:96px;resize:vertical}
input:focus,textarea:focus{outline:3px solid rgba(133,112,95,.16);border-color:var(--green)}
.opt{display:flex;gap:9px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:11px;margin:0 0 8px;font-size:.9rem;background:rgba(255,255,255,.38)}
.opt input{width:19px;height:19px;margin:0;accent-color:var(--green)}
.msg{color:var(--danger);font-size:.84rem;margin:6px 0 0}
.alert{background:#fff0f0;border:1px solid #e1b2b2;color:var(--danger);border-radius:12px;padding:14px;font-size:.88rem;margin:0 0 14px}
.muted{color:var(--muted);font-size:.86rem}
.known dt{color:var(--muted);font-size:.8rem}.known dd{margin:0 0 6px;font-weight:700}
.pre,.done{white-space:pre-wrap}
button{width:100%;border:0;border-radius:12px;padding:14px 18px;font:inherit;font-weight:700;cursor:pointer;background:linear-gradient(120deg,#8c7769,#5e534b);color:#fff;box-shadow:0 7px 18px rgba(79,65,55,.24);margin-top:8px}
button.sub{background:rgba(255,254,251,.9);color:#5e534b;border:1px solid #8c7769;box-shadow:none}
button:disabled{opacity:.42;box-shadow:none;cursor:not-allowed}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
CSS;
}

/** 院のロゴと見出し（LINE の予約申請フォームと同じ形） */
function monshin_header(string $base, string $title, string $clinic): string
{
    $h = fn($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
    // 設定の院名が「いしだ皮フ科」だけでも、患者向けの見出しは予約申請フォームと同じ正式な表記にする
    $name = $clinic === '' || str_contains($clinic, 'いしだ') ? 'いしだ皮フ科／美容皮膚科' : $clinic;
    return '<header class="clinic-header"><div class="clinic-logo"><img src="' . $h($base . 'assets/logo.webp') . '" alt=""><span><b>' . $h($name) . '</b>' . (str_contains($name, 'いしだ') ? '<small>Ishida Cosmetic Dermatology</small>' : '') . '</span></div>'
        . '<p class="eyebrow">MEDICAL QUESTIONNAIRE</p><h1 id="title">' . $h($title) . '</h1></header>';
}
