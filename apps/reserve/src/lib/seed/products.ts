import type { Product } from "@/lib/domain/types";

/** 初期のスキンケア・内服プリセット（価格は未設定。設定画面で入れる） */
const NAMES: [string, Product["category"]][] = [
  ["ゼオスキン ミラミン", "skincare"],
  ["ゼオスキン ミラクトン", "skincare"],
  ["ゼオスキン デイリーPD", "skincare"],
  ["ゼオスキン バランサートナー", "skincare"],
  ["ゼオスキン エクスフォリエーティングクレンザー", "skincare"],
  ["トレチノイン 0.025%", "skincare"],
  ["ハイドロキノン 4%", "skincare"],
  ["ビタミンC美容液", "skincare"],
  ["保湿クリーム（セラミド）", "skincare"],
  ["日焼け止め SPF50+", "skincare"],
  ["トラネキサム酸 内服", "oral"],
  ["ビタミンC 内服", "oral"],
];

export const DEFAULT_PRODUCTS: Product[] = NAMES.map(([name, category], i) => ({
  id: `prod-${String(i + 1).padStart(3, "0")}`,
  name,
  category,
  priceYen: null,
  order: i,
  active: true,
}));
