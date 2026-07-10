import { describe, it, expect } from 'vitest';
import { ChunkedGridEnvironment } from '../src/env/chunked-environment.js';
import {
  createInitialState, seedSource, createRNG, ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, run,
} from '../src/index.js';

describe('ChunkedGridEnvironment', () => {
  it('sampleGrowthContext は有限の値と単位ベクトルの preferredDirection を返す', () => {
    const env = new ChunkedGridEnvironment({ worldSize: 100_000, worldSeed: 1 });
    env.placeFood({ x: 40, y: 40 }, 10, 1.0);
    const ctx = env.sampleGrowthContext({ x: 30, y: 40 });
    expect(Number.isFinite(ctx.nutrients)).toBe(true);
    expect(Number.isFinite(ctx.moisture)).toBe(true);
    const len = Math.hypot(ctx.preferredDirection.x, ctx.preferredDirection.y);
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
  });

  it('place* メソッドが対応するフィールドに反映される', () => {
    const env = new ChunkedGridEnvironment({ worldSize: 100_000, worldSeed: 2 });
    env.placeFood({ x: 10, y: 10 }, 5, 1.0);
    env.placeStone({ x: 50, y: 50 }, 3);
    env.placeToxin({ x: 20, y: 20 }, 5, 0.5);
    expect(env.nutrients.sample(10, 10)).toBeGreaterThan(0);
    expect(env.obstacle.sampleNearest(50, 50)).toBe(1);
    expect(env.toxin.sample(20, 20)).toBeGreaterThan(0);
  });

  it('decay() は moisture を baseMoisture へ緩和し、未生成チャンクには触れない', () => {
    const env = new ChunkedGridEnvironment({ worldSize: 100_000, worldSeed: 3, baseMoisture: 0.3 });
    env.placeWater({ x: 10, y: 10 }, 5, 0.5);
    const before = env.moisture.sample(10, 10);
    expect(env.generatedChunkCount()).toBe(0); // obstacle は未生成 (place はしていない)
    for (let i = 0; i < 20; i++) env.decay(0, 0.1, 0, 0);
    const after = env.moisture.sample(10, 10);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(env.baseMoisture);
  });

  it('generateTerrain はチャンク座標ごとに決定的な地形を生成する (再現性)', () => {
    const makeEnv = () => new ChunkedGridEnvironment({
      worldSize: 100_000,
      worldSeed: 42,
      chunkCells: 32,
      cellWorldSize: 1,
      generateTerrain: (coord, rng) => ({
        obstaclePatches: rng.next() < 0.5 ? [{ x: 16, y: 16, radius: 5 }] : [],
        foodPatches: [{ x: rng.range(0, 32), y: rng.range(0, 32), radius: 3, amount: 1 }],
      }),
    });
    const a = makeEnv(), b = makeEnv();
    // 同じ (worldSeed, チャンク座標) からは同じ地形が生成される。
    for (const [cx, cy] of [[0, 0], [3, -2], [10, 10]] as const) {
      const wx = cx * 32 + 5, wy = cy * 32 + 5;
      expect(a.obstacle.sampleNearest(wx, wy)).toBe(b.obstacle.sampleNearest(wx, wy));
      expect(a.nutrients.sample(wx, wy)).toBeCloseTo(b.nutrients.sample(wx, wy), 6);
    }
  });

  // ── M30: バイオーム表現のための地形パッチ (毒素/湿度/水域) ──
  it('generateTerrain の toxin/moisture/water パッチが各フィールドへ反映される', () => {
    const env = new ChunkedGridEnvironment({
      worldSize: 100_000,
      worldSeed: 9,
      chunkCells: 32,
      cellWorldSize: 1,
      baseMoisture: 0.3,
      generateTerrain: () => ({
        toxinPatches: [{ x: 8, y: 8, radius: 4, amount: 0.6 }],
        moisturePatches: [{ x: 24, y: 8, radius: 4, amount: -0.2 }], // 乾燥地帯
        waterPatches: [{ x: 16, y: 24, radius: 3 }],
      }),
    });
    // 毒素の染み
    expect(env.toxin.sample(8, 8)).toBeGreaterThan(0.3);
    // 乾燥地帯 (base 0.3 から下がる)
    expect(env.moisture.sample(24, 8)).toBeLessThan(0.3);
    // 水域: water と obstacle の両方に立ち (通行不能)、周囲が湿る
    expect(env.water.sampleNearest(16, 24)).toBe(1);
    expect(env.obstacle.sampleNearest(16, 24)).toBe(1);
    expect(env.moisture.sample(16, 20)).toBeGreaterThan(0.3);
  });

  it('新パッチを返さない generateTerrain では毒素0・湿度base・水なし (M25 と互換)', () => {
    const env = new ChunkedGridEnvironment({
      worldSize: 100_000,
      worldSeed: 10,
      chunkCells: 32,
      cellWorldSize: 1,
      baseMoisture: 0.32,
      generateTerrain: () => ({
        foodPatches: [{ x: 16, y: 16, radius: 4, amount: 1 }],
      }),
    });
    // 実体化を促してから読む (sample は実体化する)。
    expect(env.nutrients.sample(16, 16)).toBeGreaterThan(0);
    expect(env.toxin.sample(16, 16)).toBe(0);
    expect(env.moisture.sample(16, 16)).toBeCloseTo(0.32, 6);
    expect(env.water.sampleNearest(16, 16)).toBe(0);
  });
});

describe('ChunkedGridEnvironment を使った実際の成長 (M25 の核心)', () => {
  it('チャンク境界をまたいで前線が伸び、複数チャンクが生成される', () => {
    // 各チャンクに決定的に1つ食料源を置く「果てのない野原」を模した
    // 最小構成。sim/growth.ts 側は一切変更していない — Environment
    // インターフェース越しにこの実装を渡すだけで growth が動くことの証明。
    const CHUNK_CELLS = 24;
    const CELL_WORLD = 1;
    const CHUNK_WORLD = CHUNK_CELLS * CELL_WORLD; // 24 ワールド単位/チャンク
    const env = new ChunkedGridEnvironment({
      worldSize: 100_000, // 実質無制限 (growth.ts の worldMargin 判定に掛からない大きさ)
      worldSeed: 7,
      chunkCells: CHUNK_CELLS,
      cellWorldSize: CELL_WORLD,
      generateTerrain: (_coord, rng) => ({
        // チャンク内のランダムな1点に、そこそこ広い食料パッチを置く。
        foodPatches: [{ x: rng.range(4, CHUNK_WORLD - 4), y: rng.range(4, CHUNK_WORLD - 4), radius: 6, amount: 1.2 }],
      }),
    });

    const rng = createRNG(7);
    const act = new ActivityField(100_000, 64);
    const bio = new BiomassField(100_000, 64);
    const state = createInitialState(7, 100_000);
    // worldSize を巨大にしても createInitialState 自体はワールド座標系に
    // 依存しないので、原点付近 (チャンク (0,0) 内) に種を置く。
    seedSource(state, { x: CHUNK_WORLD / 2, y: CHUNK_WORLD / 2 }, 6);
    const bus = new EventBus();

    run(state, env, act, bio, DEFAULT_PARAMS, rng, bus, 3000);

    expect(state.edges.length).toBeGreaterThan(6); // 初期分岐から実際に育っている
    expect(env.generatedChunkCount()).toBeGreaterThan(1); // 少なくとも隣接チャンクへ踏み出した

    // 実際にノードが (0,0) 以外のチャンクにも存在すること。
    const touchedChunks = new Set(
      state.nodes.map((n) => `${Math.floor(n.pos.x / CHUNK_WORLD)}:${Math.floor(n.pos.y / CHUNK_WORLD)}`),
    );
    expect(touchedChunks.size).toBeGreaterThan(1);
  });
});
