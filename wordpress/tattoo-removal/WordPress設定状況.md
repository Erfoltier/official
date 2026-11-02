# WordPress への設置状況（2026-11-02）

※ステータスは「下書き」です。公開はしていません。

| 項目 | 内容 |
|---|---|
| 投稿 | 治療メニュー（service）／投稿ID 2481／下書き |
| タイトル | 埼玉・大宮のタトゥー除去｜刺青・入れ墨除去もピコレーザーで |
| URL（公開後） | https://ishidahihuka.jp/service/tattoo-removal/ |
| プレビュー（ログイン中のみ） | https://ishidahihuka.jp/?post_type=service&p=2481&preview=true |
| カテゴリー | タトゥー除去（新規作成） |
| アイキャッチ | tattoo-pico-device.webp（メディアID 2479） |
| 本文 | 「治療メニューの情報」→コンテンツ一覧 1件目に `wordpress-paste.html` |
| CSS | 編集画面下の「カスタムCSS（この固定ページのみに適用）」に `custom.css`＋下記2行。サイト全体の追加CSSは変更なし |
| メタ情報 | Yoast SEO と TCD「SEOの設定」の両方にタイトル・ディスクリプションを設定 |
| 構造化データ | WPCode スニペット ID 2482「タトゥー除去 構造化データjson（FAQ・医療機関）」（`schema-jsonld.html`）。URLに /service/tattoo-removal/ を含むページのheadにだけ出力。公開後に有効になる |
| 画像 | メディアID 2473〜2479・面積図 tattoo-measure.webp（/wp-content/uploads/2026/11/） |

## このページ専用CSSに追加した2行

- `#single_service_title_area{display:none!important}` … テーマ標準のタイトル帯を非表示（既存のシミ取りページと同じ方式）
- （削除済み）関連メニュー欄の非表示 … アートメイク除去ページを同カテゴリーに追加したため、公開後は互いに関連メニューとして表示される

## テーマの仕様で対応したこと

- コンテンツビルダーの本文は表示時に `<script>` `<link>` `<bdi>` が除去されるため、構造化データは WPCode に分離し、改行防止タグは `<abbr class="nw">` に変更。

## 公開時にやること

1. 編集画面で「公開」を押す
2. https://search.google.com/test/rich-results でURLを検査し、FAQ等の構造化データが出ているか確認
3. フッターの診療日表記（美容皮膚科：水曜・祝日…）に「タトゥー除去は日曜日」を加えるか検討

## アートメイク除去ページ（2026-11-02 追加）

| 項目 | 内容 |
|---|---|
| 投稿 | 治療メニュー（service）／投稿ID 2485／下書き |
| タイトル | 埼玉・大宮のアートメイク除去｜眉アートメイクをピコレーザーで薄く |
| URL（公開後） | https://ishidahihuka.jp/service/artmake-removal/ |
| プレビュー | https://ishidahihuka.jp/?post_type=service&p=2485&preview=true |
| カテゴリー | タトゥー除去（タトゥー除去ページと同じ） |
| 本文・CSS | `../artmake-removal/wordpress-paste.html`、このページ専用CSSに `../artmake-removal/custom.css`＋タイトル帯非表示の1行 |
| 構造化データ | WPCode スニペット ID 2486「アートメイク除去 構造化データjson（FAQ・医療機関）」（URLに /service/artmake-removal/ を含むページのみ） |
| 画像 | artmake-measure.webp（眉の面積図）、本体写真は共用 |

公開時は、タトゥー除去ページとアートメイク除去ページを両方公開してください（相互リンクと関連メニューが有効になります）。
