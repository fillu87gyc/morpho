// ステージ (M3): 皿 (デフォルト) に加えて洞窟 / 砂漠 / 都市跡 / 湿地の
// 4種類。それぞれ地形生成関数と、環境の初期条件/自然減衰速度/
// SimParams の上書きを持つ。sim 本体には手を入れず、
// Environment.placeX() / GridEnvironmentInit だけを使って表現する
// (アーキテクチャ方針: sim はステートレスに保つ)。

import { type GridEnvironment, type SeededRNG, type SimParams, type Vec2 } from '@morpho/sim';

export type StageId = 'petri' | 'cave' | 'desert' | 'ruins' | 'wetland';

export interface StageConfig {
  id: StageId;
  name: string;
  description: string;
  baseMoisture: number;
  baseBrightness: number;
  paramOverrides: Partial<SimParams>;
  // 固定食料点 (FOOD_POINTS) の量に掛ける係数。1 未満で希少、1 超で豊富。
  foodAmountMultiplier: number;
  // 自然減衰 (1 tick あたりの割合)。放置すると栄養は消費され、水分は
  // baseMoisture へ緩和していく。
  nutrientDecayPerTick: number;
  moistureRelaxPerTick: number;
  // 地形を生成し、レンダラがステージ固有のアイコン (廃墟の柱 / 鍾乳石 / サボテン / 葦)
  // を描く目印として使う座標を返す。ステージの「らしさ」を一目で伝えるための
  // 装飾用途のみで、sim の判定には一切影響しない。
  generateTerrain(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): Vec2[];
}

export const STAGE_ORDER: StageId[] = ['petri', 'cave', 'desert', 'ruins', 'wetland'];

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

export const STAGES: Record<StageId, StageConfig> = {
  petri: {
    id: 'petri',
    name: '皿',
    description: '起伏の少ない、育成の基本となる培養皿。',
    baseMoisture: 0.3,
    baseBrightness: 0.2,
    paramOverrides: {},
    foodAmountMultiplier: 1.0,
    nutrientDecayPerTick: 0.0006,
    moistureRelaxPerTick: 0.0009,
    generateTerrain: generatePetriTerrain,
  },
  cave: {
    id: 'cave',
    name: '洞窟',
    description: '暗く湿った岩場。光を気にせず伸び広がれる。',
    baseMoisture: 0.55,
    baseBrightness: 0.05,
    paramOverrides: { brightnessPenalty: 0 },
    foodAmountMultiplier: 0.9,
    nutrientDecayPerTick: 0.0005,
    moistureRelaxPerTick: 0.0004,
    generateTerrain: generateCaveTerrain,
  },
  desert: {
    id: 'desert',
    name: '砂漠',
    description: '乾いて蒸発が早く、エサも希少。水と栄養を絶やさぬように。',
    baseMoisture: 0.12,
    baseBrightness: 0.5,
    paramOverrides: {},
    foodAmountMultiplier: 0.55,
    nutrientDecayPerTick: 0.0012,
    moistureRelaxPerTick: 0.0025,
    generateTerrain: generateDesertTerrain,
  },
  ruins: {
    id: 'ruins',
    name: '都市跡',
    description: '崩れた建物の基礎と瓦礫が入り組む。障害物を避けて広がろう。',
    baseMoisture: 0.28,
    baseBrightness: 0.22,
    paramOverrides: { obstaclePenalty: 2.6 },
    foodAmountMultiplier: 0.85,
    nutrientDecayPerTick: 0.0007,
    moistureRelaxPerTick: 0.0009,
    generateTerrain: generateRuinsTerrain,
  },
  wetland: {
    id: 'wetland',
    name: '湿地',
    description: '水と栄養に恵まれ、乾きにくい肥沃な土地。',
    baseMoisture: 0.6,
    baseBrightness: 0.15,
    paramOverrides: {},
    foodAmountMultiplier: 1.15,
    nutrientDecayPerTick: 0.0004,
    moistureRelaxPerTick: 0.0006,
    generateTerrain: generateWetlandTerrain,
  },
};
