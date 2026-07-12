// M30: 「原野」のバイオーム。チャンク座標の決定的ノイズで地帯を分け、
// 「餌のない地帯を横断して次の豊かな地帯へ届くか」という旅を発生させる
// (ROADMAP.md M30 / ビジョン第4項)。
//
// 設計:
//   - biomeAt(cx, cy, worldSeed) は純粋関数。値ノイズ (整数格子のハッシュを
//     滑らかに補間) を BIOME_NOISE_SCALE チャンク周期で引き、肥沃度/険しさ/
//     水気の3軸からバイオームを決める。同じ (チャンク座標, worldSeed) は
//     常に同じバイオーム = チャンク地形の遅延生成 (chunked-environment.ts)
//     と同じ決定論規約。
//   - ノイズのスケールはバイオーム1地帯がおよそ数チャンク (数百ワールド単位)
//     になるよう選ぶ: 痩せた荒地の横断が「数日がかりの旅」になり、かつ
//     連続しすぎて完全に詰まない (荒地にもまばらな飛び石の餌が湧く、
//     stages.ts 側の地形参照)。
//   - 採種時の変異幅 (M5 の継承) への接続もここに置く: 母体から遠く、
//     過酷なバイオームにいる個体ほど変異幅が大きい (wildMutationBoost)。

export type BiomeId = 'forest' | 'barrens' | 'rocky' | 'toxic' | 'waterside';

export const BIOME_LABEL: Record<BiomeId, string> = {
  forest: '豊かな森',
  barrens: '痩せた荒地',
  rocky: '岩場',
  toxic: '毒の窪地',
  waterside: '水辺',
};

// ── 決定的ノイズ ────────────────────────────────────────
//
// 整数格子ハッシュ: (ix, iy, seed, salt) → [0, 1)。乗算ハッシュ + ビット撹拌。
// Math.imul で 32bit に閉じるため、負のチャンク座標や大きな seed でも
// プラットフォーム非依存の同じ値になる (決定論)。
function hash01(ix: number, iy: number, seed: number, salt: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 69069) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// 値ノイズ: 格子点のハッシュ値を smoothstep で双線形補間する。
// salt で独立な格子 (肥沃度/険しさ/水気) を引き分ける。
export function valueNoise(x: number, y: number, seed: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const sx = smoothstep(x - ix), sy = smoothstep(y - iy);
  const v00 = hash01(ix, iy, seed, salt);
  const v10 = hash01(ix + 1, iy, seed, salt);
  const v01 = hash01(ix, iy + 1, seed, salt);
  const v11 = hash01(ix + 1, iy + 1, seed, salt);
  const top = v00 + (v10 - v00) * sx;
  const bot = v01 + (v11 - v01) * sx;
  return top + (bot - top) * sy;
}

// バイオーム1地帯のおおよその周期 (チャンク数)。3 = 地帯の差し渡しが
// 約3チャンク (144 ワールド単位) 規模になり、荒地の横断は「前線が一旦
// 止まり、reclaim の飛び石で数日かけて渡る」旅になる (ハーネス実測は
// ROADMAP.md M30 の実装メモ)。大きくしすぎると荒地が連続しすぎて詰む。
export const BIOME_NOISE_SCALE = 3;

// 分類しきい値。値ノイズは格子点一様乱数の補間なので 0.5 近傍に寄る —
// 裾のしきい値 (0.72/0.42) は見た目の面積比でおよそ
// 岩場+毒 15% / 荒地 30% / 水辺 10% / 森 45% になる (biomes.test.ts で担保)。
const HAZARD_CUT = 0.72;
const FERTILITY_CUT = 0.42;
const WET_CUT = 0.68;

export function biomeAt(cx: number, cy: number, worldSeed: number): BiomeId {
  const x = cx / BIOME_NOISE_SCALE, y = cy / BIOME_NOISE_SCALE;
  const fertility = valueNoise(x, y, worldSeed, 1); // 肥沃度: 餌の多寡
  const hazard = valueNoise(x, y, worldSeed, 2);    // 険しさ: 岩と毒
  // 険しい土地: 肥沃なら「毒の窪地」(毒素 + 餌豊か = リスクリワード)、
  // 痩せていれば「岩場」。
  if (hazard > HAZARD_CUT) return fertility >= 0.5 ? 'toxic' : 'rocky';
  // 痩せた土地: 餌なし〜稀の「荒地」。横断の旅を生む主役。
  if (fertility < FERTILITY_CUT) return 'barrens';
  // 水気の多い土地: 湖のある「水辺」。
  const wet = valueNoise(x, y, worldSeed, 3);
  if (wet > WET_CUT) return 'waterside';
  return 'forest';
}

// ── 子孫の出番 (M5 の継承への接続) ──────────────────────
//
// 原野で採種するとき、母体 (スタート地点) から遠くまで到達した個体・
// 過酷なバイオームに前線がいる個体ほど、子の変異幅が大きくなる。
// game.ts の mutationScaleFor(stage) に乗じる倍率 (1 = 補正なし)。

export const BIOME_MUTATION_FACTOR: Record<BiomeId, number> = {
  forest: 1.0,
  waterside: 1.0,
  rocky: 1.15,
  barrens: 1.3,  // 餌のない地帯を生き延びた系統は大きく揺らぐ
  toxic: 1.35,   // 毒への曝露は変異の源
};

// 距離の飽和点 (ワールド単位)。チャンク約10枚ぶん遠征していれば距離要因は
// 最大 (+50%)。M29-B 実測の Day 100 到達半径 (span/2 ≈ 330) と同規模。
const DISTANCE_FULL = 500;
// 倍率の上限。createChildGenome は遺伝子を 0.6..1.4 に clamp するので
// 暴走はしないが、mutationScaleFor (約0.5) × 2 = 1.0 で「新規個体と同程度の
// 揺らぎ」を超えないように抑える。
const BOOST_MAX = 2.0;

export function wildMutationBoost(originDistance: number, biome: BiomeId): number {
  const d = Math.min(1, Math.max(0, originDistance) / DISTANCE_FULL);
  return Math.min(BOOST_MAX, (1 + d * 0.5) * BIOME_MUTATION_FACTOR[biome]);
}
