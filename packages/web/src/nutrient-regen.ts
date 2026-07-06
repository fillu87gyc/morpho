// M27: 栄養の再生サイクル。
//
// 皿〜大陸のような有界ステージは初期栄養を食べ尽くすと Day 24 前後で完全に
// 停滞する (ROADMAP.md M27)。sim 本体は無改修のまま (Environment.placeFood を
// web 側から周期的に呼ぶだけ) で「拡がる→痩せる→また拡がる」を作るため、
// 「元の食料点に、季節 (day の周期関数) と局所湿度に応じた薄い量を足す」量を
// 計算する純粋関数だけをここに切り出す。実際の呼び出しは game.ts の tick() 側。

// 何日ごとの周期で栄養量が満ち欠けするか (season)。
export const REGEN_SEASON_PERIOD_DAYS = 12;
// 再生を開始する最短日数 (これより前は初期栄養がまだ十分にあるはずで、
// 早期の実績判定 (Day0 で thickEdges=0 など) を乱さないためのガード)。
export const REGEN_START_DAY = 10;
// 元の食料点の amount に対する、1回あたりの再生量の基準割合。
export const REGEN_BASE_FRACTION = 0.14;
// 元の食料点の radius に対する、再生時に撒く半径の割合 (「薄く」広がる分だけ狭める)。
export const REGEN_RADIUS_FRACTION = 0.6;

/**
 * その日の再生量 (0 以上) を計算する。season は day の正弦波 (0..1) で
 * 「満ち欠け」を表し、moisture (0..1 目安) は湿っているほど再生が進みやすい
 * ことを表す。day < REGEN_START_DAY では常に 0 (まだ再生を始めない)。
 */
export function computeRegenAmount(day: number, baseAmount: number, moisture: number): number {
  if (day < REGEN_START_DAY) return 0;
  const season = 0.5 + 0.5 * Math.sin((2 * Math.PI * (day - REGEN_START_DAY)) / REGEN_SEASON_PERIOD_DAYS);
  const moistureFactor = 0.4 + 0.6 * Math.max(0, Math.min(1, moisture));
  return baseAmount * REGEN_BASE_FRACTION * season * moistureFactor;
}
