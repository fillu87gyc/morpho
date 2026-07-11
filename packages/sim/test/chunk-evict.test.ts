// M29: チャンク evict → 復元の round-trip 検証。
//
// ChunkedFieldGrid.evictChunk はチャンクの実体 (Float32Array) を平均値1個へ
// 圧縮して解放し、再訪 (ensureChunk) 時に平均で塗り戻して復元する。復元は
// 近似 (形は失われる) だが決定的であること、evict 済みチャンクが diffuse/
// decay の走査対象 (generatedChunks) から外れること、要約 (summarize*) が
// evict をまたいで連続することを固定する。

import { describe, it, expect } from 'vitest';
import {
  ChunkedFieldGrid, ChunkedBiomassField, ChunkedGridEnvironment,
} from '../src/index.js';

describe('ChunkedFieldGrid の evict → 復元 round-trip', () => {
  it('evict で実体が解放され、再訪時に平均値で復元される', () => {
    const grid = new ChunkedFieldGrid({ chunkCells: 8, cellWorldSize: 1 });
    // チャンク (0,0) の内側だけに不均一な値を書く (半径を小さくして
    // 隣接チャンクへ滲み出さないようにする — 滲むと chunkCount が増える)。
    grid.stampGaussian(4, 4, 1, 1.0);
    const data = grid.peekChunk(0, 0)!;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] ?? 0;
    const mean = sum / data.length;
    expect(mean).toBeGreaterThan(0);

    expect(grid.evictChunk(0, 0)).toBe(true);
    expect(grid.chunkCount()).toBe(0);            // 実体は解放された
    expect(grid.evictedChunkCount()).toBe(1);     // 要約値だけが残る
    expect(grid.peekChunk(0, 0)).toBeNull();      // peek は復元しない
    expect(grid.evictedMean(0, 0)).toBeCloseTo(mean, 6);
    expect(grid.generatedChunks()).toHaveLength(0); // diffuse/decay の走査対象外

    // 再訪 (sample が ensureChunk を踏む) → 平均値の一様な土地として復元。
    const v = grid.sampleNearest(4, 4);
    expect(v).toBeCloseTo(mean, 6);
    expect(grid.chunkCount()).toBe(1);
    expect(grid.evictedChunkCount()).toBe(0);
    const restored = grid.peekChunk(0, 0)!;
    for (let i = 0; i < restored.length; i++) expect(restored[i]).toBe(restored[0]);
  });

  it('未生成/evict 済みチャンクへの evict は no-op、復元は決定的', () => {
    const make = () => {
      const g = new ChunkedFieldGrid({ chunkCells: 8, cellWorldSize: 1 });
      g.stampGaussian(4, 4, 3, 0.7);
      g.stampGaussian(6, 2, 1, 0.4);
      g.evictChunkAt(4, 4);
      g.sample(4, 4); // 復元
      return g.peekChunk(0, 0)!;
    };
    expect(new ChunkedFieldGrid({ chunkCells: 8, cellWorldSize: 1 }).evictChunk(5, 5)).toBe(false);
    const g = new ChunkedFieldGrid({ chunkCells: 8, cellWorldSize: 1 });
    g.stampGaussian(4, 4, 3, 0.7);
    g.evictChunk(0, 0);
    expect(g.evictChunk(0, 0)).toBe(false); // 二重 evict は no-op
    // 同じ操作列からは bit 一致で同じ復元結果が得られる。
    expect([...make()]).toEqual([...make()]);
  });

  it('generator 付きチャンクも、復元は generator ではなく要約値から行われる', () => {
    // 決定的な地形生成があるチャンクを evict → 復元すると、生成時の形
    // (パッチ) ではなく evict 時点の平均で塗り戻される (仕様通りの近似)。
    const grid = new ChunkedFieldGrid({
      chunkCells: 8, cellWorldSize: 1,
      generate: (_c, data) => { data[0] = 1.0; }, // 左上の1セルだけ濃い
    });
    grid.ensureChunk(0, 0);
    grid.evictChunk(0, 0);
    const restored = grid.ensureChunk(0, 0);
    expect(restored[0]).toBeCloseTo(1 / 64, 6); // 平均 = 1.0/64セル
    expect(restored[1]).toBe(restored[0]);      // 一様
  });
});

describe('要約 (summarize*) は evict をまたいで連続する (M28 の世界統計を痩せさせない)', () => {
  it('ChunkedScalarField.summarizeWorld の total が evict 前後でほぼ変わらない', () => {
    const bio = new ChunkedBiomassField(8, 1);
    bio.depositSegment({ x: 3, y: 3 }, { x: 5, y: 5 }, 0.8, 1.5);
    const before = bio.summarizeWorld(0);
    expect(before.total).toBeGreaterThan(0);
    bio.evictChunkAt(4, 4);
    expect(bio.generatedChunkCount()).toBe(0);
    const after = bio.summarizeWorld(0);
    // 平均×セル数 = 総和なので total は (浮動小数の丸めを除き) 保存される。
    expect(after.total).toBeCloseTo(before.total, 3);
    expect(after.chunkCount).toBe(before.chunkCount);
    expect(bio.touchedChunkCount()).toBe(1);
  });

  it('ChunkedGridEnvironment.summarizeChunks が evict 済みチャンクも近似で返す', () => {
    const env = new ChunkedGridEnvironment({
      worldSize: 1000, worldSeed: 5, chunkCells: 8, cellWorldSize: 1,
      generateTerrain: () => ({
        foodPatches: [{ x: 4, y: 4, radius: 2, amount: 1.0 }],
        obstaclePatches: [{ x: 2, y: 2, radius: 1 }],
      }),
    });
    env.sampleGrowthContext({ x: 4, y: 4 }); // チャンク (0,0) を実体化
    env.placeWaterBody({ x: 5, y: 5 }, 1);
    const before = env.summarizeChunks().find((s) => s.cx === 0 && s.cy === 0)!;
    expect(before.nutrientAvg).toBeGreaterThan(0);
    expect(before.obstacleDensity).toBeGreaterThan(0);
    expect(before.hasWater).toBe(true);

    env.evictChunkAt(4, 4);
    const after = env.summarizeChunks().find((s) => s.cx === 0 && s.cy === 0)!;
    expect(after.nutrientAvg).toBeCloseTo(before.nutrientAvg, 4);
    // obstacle は 0/1 の場なので平均 = 密度そのもの (障害物セル判定 >0.5 と
    // 完全一致はしないが、同じオーダーで残ることを確認)。
    expect(after.obstacleDensity).toBeGreaterThan(0);
    expect(after.hasWater).toBe(true);
    expect(env.generatedChunkCount()).toBe(0);
    expect(env.evictedChunkCount()).toBe(1);
    expect(env.touchedChunkCount()).toBe(1);
  });

  // M32: 「発見バイオーム数」など座標だけで決まる派生指標を安く求めるための
  // 軽量 API。evict 済みも含めて座標だけを返す (セルデータは読まない)。
  it('touchedChunkCoords は実体 + evict 済みチャンクの座標を返す (evict 後も座標は残る)', () => {
    const env = new ChunkedGridEnvironment({ worldSize: 1000, worldSeed: 9, chunkCells: 8, cellWorldSize: 1 });
    env.sampleGrowthContext({ x: 4, y: 4 }); // (0,0)
    env.sampleGrowthContext({ x: 12, y: 4 }); // (1,0)
    expect(env.touchedChunkCoords()).toHaveLength(2);
    env.evictChunkAt(4, 4);
    const coords = env.touchedChunkCoords();
    expect(coords).toHaveLength(2);
    expect(coords).toEqual(expect.arrayContaining([{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]));
  });
});
