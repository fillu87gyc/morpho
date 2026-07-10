// ステージ (M3): 皿 (デフォルト) に加えて洞窟 / 砂漠 / 都市跡 / 湿地の
// 4種類。それぞれ地形生成関数と、環境の初期条件/自然減衰速度/
// SimParams の上書きを持つ。sim 本体には手を入れず、
// Environment.placeX() / GridEnvironmentInit だけを使って表現する
// (アーキテクチャ方針: sim はステートレスに保つ)。

import { type GridEnvironment, type SeededRNG, type SimParams, type Vec2 } from '@morpho/sim';
import { biomeAt, type BiomeId } from './biomes.js';

export type StageId = 'petri' | 'cave' | 'desert' | 'ruins' | 'wetland' | 'continent' | 'wildland';

// M25: 「原野」用のチャンク単位の地形生成 (無限ワールド)。既存6ステージの
// generateTerrain (GridEnvironment 全体を一度だけ焼く) とは前提が違う —
// ChunkedGridEnvironment がチャンクを初めて触れた瞬間に1度ずつ呼ばれる。
// M30: バイオーム表現のため toxin/moisture/water を追加 (sim 側の
// ChunkedGridEnvironmentInit.generateTerrain と同じ形)。
export interface ChunkTerrainResult {
  obstaclePatches?: { x: number; y: number; radius: number }[];
  foodPatches?: { x: number; y: number; radius: number; amount: number }[];
  toxinPatches?: { x: number; y: number; radius: number; amount: number }[];
  moisturePatches?: { x: number; y: number; radius: number; amount: number }[];
  waterPatches?: { x: number; y: number; radius: number }[];
}

// M14: 大陸ステージ専用。source (拠点の種となるコロニー核) と
// 食料拠点を手続き的に生成して返す。
export interface WorldPoints {
  sources: Vec2[];
  food: { pos: Vec2; radius: number; amount: number }[];
}

export interface StageConfig {
  id: StageId;
  name: string;
  description: string;
  baseMoisture: number;
  baseBrightness: number;
  // M10: 「土地本来」の温度。全ステージ 0.5 (SimParams.tempOptimal の既定値と
  // 揃えてある) にして、プレイヤーが温度ツールで動かさない限りは
  // どのステージでも成長に影響しない。
  baseTemperature: number;
  paramOverrides: Partial<SimParams>;
  // 固定食料点 (FOOD_POINTS) の量に掛ける係数。1 未満で希少、1 超で豊富。
  foodAmountMultiplier: number;
  // 自然減衰 (1 tick あたりの割合)。放置すると栄養は消費され、水分/温度は
  // baseMoisture/baseTemperature へ緩和していき、毒素はゆっくり分解される。
  nutrientDecayPerTick: number;
  moistureRelaxPerTick: number;
  tempRelaxPerTick: number;
  toxinDecayPerTick: number;
  // 地形を生成し、レンダラがステージ固有のアイコン (廃墟の柱 / 鍾乳石 / サボテン / 葦)
  // を描く目印として使う座標を返す。ステージの「らしさ」を一目で伝えるための
  // 装飾用途のみで、sim の判定には一切影響しない。
  generateTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[];
  // M14: 省略時は game.ts 側の固定 SOURCE_POINTS/FOOD_POINTS を使う
  // (既存5ステージの挙動・rng 消費順は一切変えない)。大陸ステージだけが
  // これを定義し、拠点をポアソンディスク風に手続き生成する。
  worldPoints?(rng: SeededRNG, worldSize: number): WorldPoints;
  // M25: このステージが半無限ワールド (ChunkedGridEnvironment ベース) かどうか。
  // 省略時は false (既存6ステージ)。true のときだけ game.ts が別経路を通る。
  infinite?: boolean;
  // M25: 「原野」専用のチャンク単位地形生成 (infinite=true のときだけ使う)。
  chunkTerrain?(coord: { cx: number; cy: number }, rng: SeededRNG, worldSeed: number): ChunkTerrainResult;
}

export const STAGE_ORDER: StageId[] = ['petri', 'cave', 'desert', 'ruins', 'wetland', 'continent'];

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── 皿 (デフォルト): 岩場 / 砂地 / 草地 / 水場 / 陽だまりを均等にばら撒く ──

type BiomeKind = 'rock' | 'sand' | 'grass' | 'water' | 'light';

const PETRI_WEIGHTS: [BiomeKind, number][] = [
  ['grass', 0.30],
  ['rock', 0.25],
  ['sand', 0.22],
  ['water', 0.13],
  ['light', 0.10],
];

function pickWeighted<T extends string>(rng: SeededRNG, weights: [T, number][]): T {
  const r = rng.next();
  let acc = 0;
  for (const [kind, w] of weights) {
    acc += w;
    if (r < acc) return kind;
  }
  return weights[weights.length - 1]![0];
}

function placeRockCluster(env: GridEnvironment, rng: SeededRNG, center: Vec2, patchRadius: number, avoidPoints: Vec2[], avoidRadius: number): void {
  const rockCount = rng.int(3, 7);
  for (let j = 0; j < rockCount; j++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, patchRadius * 0.7);
    const pos: Vec2 = { x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d };
    if (avoidPoints.some((p) => dist(p, pos) < avoidRadius * 0.6)) continue;
    env.placeStone(pos, rng.range(1.4, 3.2));
  }
}

function generatePetriTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[] {
  const patchCount = rng.int(9, 14);
  const avoidRadius = 9; // source / 固定食料点の近くには岩を置かない (通行止め防止)

  for (let i = 0; i < patchCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    const kind = pickWeighted(rng, PETRI_WEIGHTS);
    const patchRadius = rng.range(9, 20);

    if (kind === 'rock') {
      if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
      placeRockCluster(env, rng, center, patchRadius, avoidPoints, avoidRadius);
      continue;
    }

    switch (kind) {
      case 'sand':
        env.placeLight(center, patchRadius, rng.range(0.18, 0.32));
        env.placeWater(center, patchRadius * 0.9, -rng.range(0.08, 0.16));
        break;
      case 'grass':
        env.placeWater(center, patchRadius * 0.85, rng.range(0.10, 0.20));
        env.placeFood(center, patchRadius * 0.5, rng.range(0.12, 0.25));
        break;
      case 'water':
        env.placeWater(center, patchRadius * 0.7, rng.range(0.30, 0.5));
        break;
      case 'light':
        env.placeLight(center, patchRadius * 0.7, rng.range(0.28, 0.45));
        break;
    }
  }
  return [];
}

// ── 洞窟: 暗く (光ペナルティ無効)、湿度が高い。岩壁と水たまりが主体 ──

function generateCaveTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[] {
  const avoidRadius = 9;
  const landmarks: Vec2[] = [];
  const rockClusters = rng.int(10, 15);
  for (let i = 0; i < rockClusters; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
    placeRockCluster(env, rng, center, rng.range(10, 22), avoidPoints, avoidRadius);
    if (rng.next() < 0.5) landmarks.push(center); // 岩塊の一部を鍾乳石/石筍として描く
  }
  const poolCount = rng.int(5, 8);
  for (let i = 0; i < poolCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    env.placeWater(center, rng.range(6, 14), rng.range(0.35, 0.55));
  }
  return landmarks;
}

// ── 砂漠: 蒸発が早く、エサ希少。砂地が主体で稀にオアシス ──

function generateDesertTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[] {
  const avoidRadius = 9;
  const landmarks: Vec2[] = [];
  const sandPatches = rng.int(10, 16);
  for (let i = 0; i < sandPatches; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    env.placeLight(center, rng.range(10, 22), rng.range(0.20, 0.35));
    env.placeWater(center, rng.range(8, 18), -rng.range(0.05, 0.10));
    if (rng.next() < 0.35 && !avoidPoints.some((p) => dist(p, center) < avoidRadius)) {
      landmarks.push(center); // 砂丘のそばにサボテンを立てる
    }
  }
  const oasisCount = rng.int(1, 3);
  for (let i = 0; i < oasisCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
    env.placeWater(center, rng.range(5, 9), rng.range(0.4, 0.6));
    env.placeFood(center, rng.range(3, 6), rng.range(0.15, 0.3));
  }
  const rockCount = rng.int(2, 4);
  for (let i = 0; i < rockCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
    placeRockCluster(env, rng, center, rng.range(6, 12), avoidPoints, avoidRadius);
  }
  return landmarks;
}

// ── 都市跡: 障害物テンプレート (建物の基礎跡) + ランダムな瓦礫 ──

function placeRuinTemplate(env: GridEnvironment, rng: SeededRNG, center: Vec2): void {
  // 矩形の輪郭に沿って岩を並べる。ところどころ崩れて欠けているのが
  // 「跡」らしさ (連続した壁ではなく、通行できる隙間が残る)。
  const w = rng.range(10, 20);
  const h = rng.range(10, 20);
  const x0 = center.x - w / 2, x1 = center.x + w / 2;
  const y0 = center.y - h / 2, y1 = center.y + h / 2;
  const step = 2.2;
  const perimeter: Vec2[] = [];
  for (let x = x0; x <= x1; x += step) { perimeter.push({ x, y: y0 }); perimeter.push({ x, y: y1 }); }
  for (let y = y0; y <= y1; y += step) { perimeter.push({ x: x0, y }); perimeter.push({ x: x1, y }); }
  for (const p of perimeter) {
    if (rng.next() < 0.35) continue; // 崩れて欠けている箇所
    env.placeStone(p, rng.range(1.0, 1.8));
  }
}

function generateRuinsTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[] {
  const avoidRadius = 11;
  const landmarks: Vec2[] = [];
  const templateCount = rng.int(3, 5);
  for (let i = 0; i < templateCount; i++) {
    const center: Vec2 = { x: rng.range(worldSize * 0.15, worldSize * 0.85), y: rng.range(worldSize * 0.15, worldSize * 0.85) };
    if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
    placeRuinTemplate(env, rng, center);
    landmarks.push(center); // 崩れた柱をこの区画の中心に描く
  }
  // 瓦礫: ランダムな小石をばら撒く
  const rubbleCount = rng.int(14, 22);
  for (let i = 0; i < rubbleCount; i++) {
    const pos: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    if (avoidPoints.some((p) => dist(p, pos) < 6)) continue;
    env.placeStone(pos, rng.range(0.8, 1.6));
  }
  // 自然が跡地を取り戻しつつある: まばらな草地
  const grassPatches = rng.int(4, 7);
  for (let i = 0; i < grassPatches; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    env.placeWater(center, rng.range(6, 12), rng.range(0.08, 0.16));
    env.placeFood(center, rng.range(3, 6), rng.range(0.10, 0.20));
  }
  return landmarks;
}

// ── 湿地: 水と栄養が豊かで、乾きにくい ──

function generateWetlandTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[] {
  const avoidRadius = 9;
  const landmarks: Vec2[] = [];
  const waterPatches = rng.int(10, 15);
  for (let i = 0; i < waterPatches; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    env.placeWater(center, rng.range(10, 20), rng.range(0.25, 0.45));
    if (rng.next() < 0.6) env.placeFood(center, rng.range(4, 9), rng.range(0.12, 0.25));
    if (rng.next() < 0.45) landmarks.push(center); // 水辺に葦の茂みを描く
  }
  const rockCount = rng.int(1, 3);
  for (let i = 0; i < rockCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
    placeRockCluster(env, rng, center, rng.range(6, 10), avoidPoints, avoidRadius);
  }
  return landmarks;
}

// ── 大陸: 広大な世界。source 6 箇所・食料拠点 20〜30 個をポアソンディスク風に
// 配置し、湖や入り江を水域として散らす ──

// 「半径以内に既存点/avoid点がないか」だけを見る素朴な棄却サンプリング。
// 拠点は多くても数十個なので O(N²) で十分 (game.ts の clusterCount と同じ考え方)。
function poissonPoints(rng: SeededRNG, worldSize: number, margin: number, count: number, minDist: number, avoid: Vec2[]): Vec2[] {
  const pts: Vec2[] = [];
  const maxAttempts = count * 300;
  let attempts = 0;
  while (pts.length < count && attempts < maxAttempts) {
    attempts++;
    const p: Vec2 = { x: rng.range(margin, worldSize - margin), y: rng.range(margin, worldSize - margin) };
    if (avoid.some((a) => dist(p, a) < minDist)) continue;
    if (pts.some((q) => dist(p, q) < minDist)) continue;
    pts.push(p);
  }
  return pts;
}

function generateContinentWorldPoints(rng: SeededRNG, worldSize: number): WorldPoints {
  const sources = poissonPoints(rng, worldSize, 10, 6, 16, []);
  const food = poissonPoints(rng, worldSize, 6, 24, 7, sources).map((pos) => ({
    pos, radius: rng.range(3.0, 5.0), amount: rng.range(0.75, 1.1),
  }));
  return { sources, food };
}

function generateContinentTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[] {
  const avoidRadius = 8;
  const landmarks: Vec2[] = [];
  // 湖・入り江: 拠点を避けて水域を敷く (通行不能 + 周囲の湿度供給、環境側で実装)。
  const lakeCount = rng.int(4, 7);
  for (let i = 0; i < lakeCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
    env.placeWaterBody(center, rng.range(5, 11));
    if (rng.next() < 0.6) landmarks.push(center); // 水辺の葦
  }
  // 岩場: 大陸らしい起伏を少量だけ散らす (詰まりすぎないよう控えめに)
  const rockCount = rng.int(3, 6);
  for (let i = 0; i < rockCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
    placeRockCluster(env, rng, center, rng.range(5, 9), avoidPoints, avoidRadius);
  }
  return landmarks;
}

// 「原野」のチャンク一辺のセル数 (ChunkedGridEnvironment の chunkCells と
// chunkTerrain のローカル座標範囲を揃えるための共有定数)。
export const WILDLAND_CHUNK_CELLS = 48;

// M30: 原野の実座標系の広さと開始点。growth.ts の worldMargin 境界判定に
// 実用上ひっかからない程度に大きい値 (実質「無限」)。game.ts と main.ts
// (採種時の実座標復元) が同じ値を共有できるよう、ここで定義する。
export const WILDLAND_WORLD_SIZE = 1_000_000;
export const WILDLAND_CENTER: Vec2 = { x: WILDLAND_WORLD_SIZE / 2, y: WILDLAND_WORLD_SIZE / 2 };

// 開始点を含むチャンク番地。開始地点の周囲 (Chebyshev 1チャンク以内) は
// ノイズの結果に依らず「母体の森」として豊かに固定する — 初手が荒地や
// 毒地帯で即詰みになる seed を作らないための救済 (M31 の「極小スタート」
// はこの上に別途設計する)。
const WILDLAND_HOME_CX = Math.floor(WILDLAND_CENTER.x / WILDLAND_CHUNK_CELLS);
const WILDLAND_HOME_CY = Math.floor(WILDLAND_CENTER.y / WILDLAND_CHUNK_CELLS);

// M30: 原野のチャンク地形をバイオームで生成する。純粋なノイズ分類は
// biomes.ts (vitest 対象)、ここは「バイオーム → どんなパッチを湧かすか」。
// rng はチャンクごとに (worldSeed, cx, cy) から決定的に引き直される
// (chunked-environment.ts) ので、バイオームごとに消費数が違っても他の
// チャンクへ影響しない。
export function wildlandChunkTerrain(coord: { cx: number; cy: number }, rng: SeededRNG, worldSeed: number): ChunkTerrainResult {
  const cells = WILDLAND_CHUNK_CELLS;
  const p = () => rng.range(4, cells - 4); // チャンク内のランダム点 (縁は避ける)
  const home = Math.max(Math.abs(coord.cx - WILDLAND_HOME_CX), Math.abs(coord.cy - WILDLAND_HOME_CY)) <= 1;
  const biome: BiomeId = home ? 'forest' : biomeAt(coord.cx, coord.cy, worldSeed);
  switch (biome) {
    case 'forest': {
      // 豊かな森: 餌パッチ多め (2つ) + 湿潤。M25→M29 の一様地形 (全チャンク
      // 1パッチ, amount 0.9-1.3) より少し豊か。
      return {
        foodPatches: [
          { x: p(), y: p(), radius: rng.range(4, 6), amount: rng.range(1.0, 1.4) },
          { x: p(), y: p(), radius: rng.range(3, 5), amount: rng.range(0.8, 1.1) },
        ],
        moisturePatches: [{ x: p(), y: p(), radius: rng.range(10, 16), amount: rng.range(0.10, 0.18) }],
        obstaclePatches: rng.next() < 0.15 ? [{ x: p(), y: p(), radius: rng.range(2, 3.5) }] : [],
      };
    }
    case 'barrens': {
      // 痩せた荒地: 餌なし〜稀 (30% で小さな飛び石が1つ)。乾いている。
      // 横断の旅を生む主役 — 前線はここで一旦止まり、reclaim の這い出しで
      // 飛び石を伝って渡る。飛び石ゼロにすると連続した荒地で完全に詰む
      // (ハーネス実測、ROADMAP.md M30 実装メモ)。
      return {
        foodPatches: rng.next() < 0.30
          ? [{ x: p(), y: p(), radius: rng.range(2.5, 3.5), amount: rng.range(0.35, 0.55) }]
          : [],
        moisturePatches: [{ x: p(), y: p(), radius: rng.range(12, 20), amount: -rng.range(0.06, 0.12) }],
        obstaclePatches: rng.next() < 0.2 ? [{ x: p(), y: p(), radius: rng.range(2, 3) }] : [],
      };
    }
    case 'rocky': {
      // 岩場: 障害物多・餌少。通れるが遠回りになる。
      const rocks = 3 + Math.floor(rng.next() * 3); // 3〜5
      return {
        obstaclePatches: Array.from({ length: rocks }, () => ({ x: p(), y: p(), radius: rng.range(2.5, 5) })),
        foodPatches: rng.next() < 0.6
          ? [{ x: p(), y: p(), radius: rng.range(3, 4.5), amount: rng.range(0.6, 0.9) }]
          : [],
      };
    }
    case 'toxic': {
      // 毒の窪地: 毒素 + 餌豊か (リスクリワード)。toxinPenalty (と genome の
      // toxinResistance) が働くので、系統によっては素通りできる。
      return {
        toxinPatches: [
          { x: p(), y: p(), radius: rng.range(5, 8), amount: rng.range(0.35, 0.55) },
          { x: p(), y: p(), radius: rng.range(4, 6), amount: rng.range(0.25, 0.4) },
        ],
        foodPatches: [
          { x: p(), y: p(), radius: rng.range(4, 6), amount: rng.range(1.2, 1.6) },
          { x: p(), y: p(), radius: rng.range(3, 5), amount: rng.range(0.9, 1.2) },
        ],
        moisturePatches: [{ x: p(), y: p(), radius: rng.range(10, 14), amount: rng.range(0.08, 0.15) }],
      };
    }
    case 'waterside': {
      // 水辺: 水域 (通行不能) + 湿潤 + 中程度の餌。
      const lakes = 1 + (rng.next() < 0.5 ? 1 : 0);
      return {
        waterPatches: Array.from({ length: lakes }, () => ({ x: p(), y: p(), radius: rng.range(3, 6) })),
        foodPatches: [{ x: p(), y: p(), radius: rng.range(4, 6), amount: rng.range(0.9, 1.3) }],
        moisturePatches: [{ x: p(), y: p(), radius: rng.range(10, 16), amount: rng.range(0.12, 0.2) }],
      };
    }
  }
}

export const STAGES: Record<StageId, StageConfig> = {
  petri: {
    id: 'petri',
    name: '皿',
    description: '起伏の少ない、育成の基本となる培養皿。',
    baseMoisture: 0.3,
    baseBrightness: 0.2,
    baseTemperature: 0.5,
    paramOverrides: {},
    foodAmountMultiplier: 1.0,
    nutrientDecayPerTick: 0.0006,
    moistureRelaxPerTick: 0.0009,
    tempRelaxPerTick: 0.0009,
    toxinDecayPerTick: 0.0015,
    generateTerrain: generatePetriTerrain,
  },
  cave: {
    id: 'cave',
    name: '洞窟',
    description: '暗く湿った岩場。光を気にせず伸び広がれる。',
    baseMoisture: 0.55,
    baseBrightness: 0.05,
    baseTemperature: 0.5,
    paramOverrides: { brightnessPenalty: 0 },
    foodAmountMultiplier: 0.9,
    nutrientDecayPerTick: 0.0005,
    moistureRelaxPerTick: 0.0004,
    tempRelaxPerTick: 0.0004,
    // 空気がこもりがちで毒素が抜けにくい。
    toxinDecayPerTick: 0.0010,
    generateTerrain: generateCaveTerrain,
  },
  desert: {
    id: 'desert',
    name: '砂漠',
    description: '乾いて蒸発が早く、エサも希少。水と栄養を絶やさぬように。',
    baseMoisture: 0.12,
    baseBrightness: 0.5,
    baseTemperature: 0.5,
    paramOverrides: {},
    foodAmountMultiplier: 0.55,
    nutrientDecayPerTick: 0.0012,
    moistureRelaxPerTick: 0.0025,
    tempRelaxPerTick: 0.0025,
    toxinDecayPerTick: 0.0012,
    generateTerrain: generateDesertTerrain,
  },
  ruins: {
    id: 'ruins',
    name: '都市跡',
    description: '崩れた建物の基礎と瓦礫が入り組む。障害物を避けて広がろう。',
    baseMoisture: 0.28,
    baseBrightness: 0.22,
    baseTemperature: 0.5,
    paramOverrides: { obstaclePenalty: 2.6 },
    foodAmountMultiplier: 0.85,
    nutrientDecayPerTick: 0.0007,
    moistureRelaxPerTick: 0.0009,
    tempRelaxPerTick: 0.0009,
    toxinDecayPerTick: 0.0012,
    generateTerrain: generateRuinsTerrain,
  },
  wetland: {
    id: 'wetland',
    name: '湿地',
    description: '水と栄養に恵まれ、乾きにくい肥沃な土地。',
    baseMoisture: 0.6,
    baseBrightness: 0.15,
    baseTemperature: 0.5,
    paramOverrides: {},
    foodAmountMultiplier: 1.15,
    nutrientDecayPerTick: 0.0004,
    moistureRelaxPerTick: 0.0006,
    tempRelaxPerTick: 0.0006,
    // 水の流れが毒素を洗い流しやすい。
    toxinDecayPerTick: 0.0022,
    generateTerrain: generateWetlandTerrain,
  },
  continent: {
    id: 'continent',
    name: '大陸',
    description: '拠点20〜30・湖の点在する広大な世界。水域を避けて大陸全体へ広がろう。',
    baseMoisture: 0.32,
    baseBrightness: 0.22,
    baseTemperature: 0.5,
    // 拠点間の距離が長く迂回も増えるため、都市跡ほどではないが障害物 (水域含む) を
    // 少し避けやすくする。
    paramOverrides: { obstaclePenalty: 1.6 },
    foodAmountMultiplier: 1.0,
    nutrientDecayPerTick: 0.0007,
    moistureRelaxPerTick: 0.0009,
    tempRelaxPerTick: 0.0009,
    toxinDecayPerTick: 0.0015,
    generateTerrain: generateContinentTerrain,
    worldPoints: generateContinentWorldPoints,
  },
  // M25: 半無限ワールド。ChunkedGridEnvironment + forager reclaim (sim 側で
  // 実証済み: test/forage-reclaim.test.ts) により、前線が尽きず伸び続ける。
  // 既存6ステージと違い generateTerrain (一括生成) は使わず、chunkTerrain が
  // チャンクを初めて訪れた瞬間に決定的な地形を生成する。
  wildland: {
    id: 'wildland',
    name: '原野',
    description: '果てのない野原。歩けば歩くほど、その先にも大地が続いている。',
    baseMoisture: 0.32,
    baseBrightness: 0.22,
    baseTemperature: 0.5,
    // sim/test/forage-reclaim.test.ts で実証済みの値。0 (既定・無効) だと
    // 前線が sink で詰まり Day24 相当で完全停止する (ROADMAP.md M25)。
    paramOverrides: {
      forageReclaimThreshold: 0.3,
      // M29: 成熟領域の休眠 + チャンク evict。前線 (最新 born 上位4セル +
      // margin 1セル) 以外のエッジは更新を止め、awake から遠いチャンクは
      // 平均値へ圧縮して解放する。値は sim 直接駆動の実測
      // (docs/playtest-2026-07-09-infinite/sim-100day-dormancy.txt) で
      // span を維持しつつチャンク数が頭打ちになった推奨値。既存6ステージは
      // dormancyCheckInterval=0 (既定) のままなので bit 一致で不変。
      dormancyCheckInterval: 60,
      // 休眠セル一辺。チャンク一辺 (WILDLAND_CHUNK_CELLS=48 × 1) のちょうど
      // 半分 = 1チャンクが 2×2 セルに整数分割される。48 (1:1) との対照実験では
      // 24 の方が前線の awake 領域を細かく絞れて Day 40 で 13ms/tick vs 31ms/tick
      // (span はほぼ同じ 613 vs 594)。evict の判定はチャンク中心セル ±1 なので
      // セルがチャンクより細かくても awake に重なるチャンクを誤って解放しない。
      dormancyCellWorld: 24,
      dormancyFrontierCells: 4,
      dormancyFrontierMargin: 1,
      dormancyEvict: true,
      // M29: 稠密化の抑制。出荷構成 (applyGenome(PETRI_PARAMS, genome)) は
      // 皿サイズの「面を膜で埋める」チューニングで、原野では横芽が前進より
      // 速く、窓の中が迷路化していた (第5回実測: Day 16 でエッジ6,908本、
      // 実効45〜60秒/日)。横芽の条件を DEFAULT 寄りへ絞ると、Day 40 の
      // 対照実験 (同一 seed、Game 直接駆動) でエッジ 8,729→1,529 (-82%) に
      // 対して span は 677→613 (-9%) に留まり、「エッジ数の増加 < span の
      // 増加」へ配分が反転する (ROADMAP.md M29 の実装メモ参照)。
      lateralBudBiomassThreshold: 0.55,
      lateralBudProbability: 0.12,
    },
    foodAmountMultiplier: 1.0,
    nutrientDecayPerTick: 0.0006,
    moistureRelaxPerTick: 0.0009,
    tempRelaxPerTick: 0.0009,
    toxinDecayPerTick: 0.0015,
    infinite: true,
    // 無限ステージでは使わない (chunkTerrain が代わりを務める)。型を満たす
    // だけの no-op。
    generateTerrain: () => [],
    chunkTerrain: (_coord, rng, _worldSeed): ChunkTerrainResult => {
      const cells = WILDLAND_CHUNK_CELLS;
      const obstaclePatches = rng.next() < 0.35
        ? [{ x: rng.range(4, cells - 4), y: rng.range(4, cells - 4), radius: rng.range(2, 5) }]
        : [];
      const foodPatches = [{
        x: rng.range(4, cells - 4), y: rng.range(4, cells - 4),
        radius: rng.range(4, 6), amount: rng.range(0.9, 1.3),
      }];
      return { obstaclePatches, foodPatches };
    },
  },
};
