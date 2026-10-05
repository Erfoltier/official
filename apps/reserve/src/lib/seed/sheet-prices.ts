/**
 * いしだ皮フ科の「自費商品、メニュー外値段表」（ゼオなど値段・特殊メニュー）を、sheet-prices.gs と同じ読み方で写したもの。
 * Apps Script がまだ送っていない院に、1回だけ入れる（送られてきたら、その内容にまるごと入れ替わる）
 */
import items from "./sheet-prices.json";

export const SHEET_PRICES_LABEL = "自費商品、メニュー外値段表";
export const SHEET_PRICES: { category: string; name: string; priceYen: number; priceText?: string }[] = items;
