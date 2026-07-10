// M28: チャンク要約 API のテスト。
// - ChunkedGridEnvironment.summarizeChunks(): 地形 (栄養平均/障害物密度/水の有無)
// - ChunkedScalarField.summarizeChunks()/summarizeWorld(): バイオマス等の総和と
//   閾値超過セル数 (全世界統計)
// どちらも「読むだけで副作用がない (チャンクを実体化しない)」ことが決定論の
// 前提なので、それ自体もここで守る。

import { describe, it, expect } from 'vitest';
import { ChunkedGridEnvironment } from '../src/env/chunked-environment.js';
import { ChunkedBiomassField } from '../src/field/chunked-scalar-field.js';

const CHUNK = 32;

function makeEnv(seed = 1): ChunkedGridEnvironment {
  return new ChunkedGridEnvironment({
    worldSize: 100_000, worldSeed: seed, chunkCells: CHUNK, cellWorldSize: 1,
  });
}

describe('ChunkedGridEnvironment.summarizeChunks (M28)', () => {
  it('何も生成されていなければ空、生成済みチャンクの数だけ要約が返る', () => {
    const env = makeEnv();
    expect(env.summarizeChunks()).toEqual([]);
    env.placeStone({ x: 16, y: 16 }, 3);
    const summaries = env.summarizeChunks();
    expect(summaries.length).toBe(env.generatedChunkCount());
    expect(summaries.length).toBeGreaterThan(0);
  });

  it('要約の取得は読むだけで、チャンクを実体化しない (副作用なし)', () => {
    const env = makeEnv();
    env.placeStone({ x: 16, y: 16 }, 3);
    const before = env.generatedChunkCount();
    env.summarizeChunks();
    env.summarizeChunks();
    expect(env.generatedChunkCount()).toBe(before);
  });

  it('栄養平均・障害物密度・水の有無が対応するチャンクに反映される', () => {
    const env = makeEnv();
    // チャンク (0,0): 栄養 + 障害物。境界をまたがないよう中央に置く。
    env.placeFood({ x: 16, y: 16 }, 4, 1.0);
    env.placeStone({ x: 16, y: 16 }, 3);
    // チャンク (2,0): 水域 (placeWaterBody は water + obstacle に書く)。
    env.placeWaterBody({ x: CHUNK * 2 + 16, y: 16 }, 3);

    const byKey = new Map(env.summarizeChunks().map((s) => [`${s.cx}:${s.cy}`, s]));
    const origin = byKey.get('0:0')!;
    expect(origin.nutrientAvg).toBeGreaterThan(0);
    expect(origin.obstacleDensity).toBeGreaterThan(0);
    expect(origin.obstacleDensity).toBeLessThanOrEqual(1);
    expect(origin.hasWater).toBe(false);

    const lake = byKey.get('2:0')!;
    expect(lake.hasWater).toBe(true);
    // 水域チャンクには栄養を撒いていないので平均は 0 のまま。
    expect(lake.nutrientAvg).toBe(0);
  });

  it('M30: 毒素の平均 (toxinAvg) が対応するチャンクに反映される', () => {
    const env = makeEnv();
    env.placeToxin({ x: 16, y: 16 }, 4, 0.8);
    env.placeStone({ x: CHUNK * 2 + 16, y: 16 }, 2); // 毒のない対照チャンク
    const byKey = new Map(env.summarizeChunks().map((s) => [`${s.cx}:${s.cy}`, s]));
    expect(byKey.get('0:0')!.toxinAvg).toBeGreaterThan(0);
    expect(byKey.get('2:0')!.toxinAvg).toBe(0);
  });

  it('負のチャンク座標でも正しい番地に要約が返る', () => {
    const env = makeEnv();
    env.placeStone({ x: -CHUNK + 16, y: -CHUNK + 16 }, 3);
    const summaries = env.summarizeChunks();
    expect(summaries.some((s) => s.cx === -1 && s.cy === -1)).toBe(true);
  });
});

describe('ChunkedScalarField.summarizeChunks / summarizeWorld (M28)', () => {
  it('deposit した量がチャンク要約の総和と閾値超過セル数に現れる', () => {
    const bio = new ChunkedBiomassField(CHUNK, 1);
    bio.deposit({ x: 10, y: 10 }, 0.5, 3);
    bio.deposit({ x: CHUNK * 3 + 10, y: CHUNK * 3 + 10 }, 0.5, 3); // 離れた別チャンク
    const chunks = bio.summarizeChunks(0.05);
    expect(chunks.length).toBe(bio.generatedChunkCount());
    const withBody = chunks.filter((s) => s.cellsAbove > 0);
    expect(withBody.length).toBe(2);
    for (const s of withBody) expect(s.total).toBeGreaterThan(0);
  });

  it('summarizeWorld はチャンク要約の合算と一致する (全世界統計)', () => {
    const bio = new ChunkedBiomassField(CHUNK, 1);
    bio.deposit({ x: 10, y: 10 }, 0.8, 4);
    bio.deposit({ x: CHUNK + 10, y: 10 }, 0.8, 4);
    const chunks = bio.summarizeChunks(0.05);
    const world = bio.summarizeWorld(0.05);
    expect(world.total).toBeCloseTo(chunks.reduce((a, s) => a + s.total, 0), 6);
    expect(world.cellsAbove).toBe(chunks.reduce((a, s) => a + s.cellsAbove, 0));
    expect(world.chunkCount).toBe(chunks.length);
    expect(world.total).toBeGreaterThan(0);
    expect(world.cellsAbove).toBeGreaterThan(0);
  });

  it('閾値を上げると超過セル数は単調に減り、総和は変わらない', () => {
    const bio = new ChunkedBiomassField(CHUNK, 1);
    bio.deposit({ x: 10, y: 10 }, 1.0, 5);
    const low = bio.summarizeWorld(0.01);
    const high = bio.summarizeWorld(0.5);
    expect(high.cellsAbove).toBeLessThanOrEqual(low.cellsAbove);
    expect(high.total).toBeCloseTo(low.total, 6);
  });

  it('要約の取得は読むだけで、チャンク集合を変えない (副作用なし)', () => {
    const bio = new ChunkedBiomassField(CHUNK, 1);
    bio.deposit({ x: 10, y: 10 }, 0.5, 3);
    const before = bio.generatedChunkCount();
    bio.summarizeChunks(0.05);
    bio.summarizeWorld(0.05);
    expect(bio.generatedChunkCount()).toBe(before);
  });
});
