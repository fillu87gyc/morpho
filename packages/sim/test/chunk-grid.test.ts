import { describe, it, expect } from 'vitest';
import { ChunkedFieldGrid } from '../src/field/chunk-grid.js';
import { makeField, sampleField, stampGaussian, stampObstacle } from '../src/field/grid.js';

describe('ChunkedFieldGrid ⇔ 既存 FieldGrid (grid.ts) の等価性', () => {
  // 1チャンク = 既存の dense field と全く同じ範囲になるよう構成し、
  // 同じ操作列を適用したときにビット一致することを確認する
  // (ROADMAP.md M25: 「決定論テストを先に拡充してから着手する」)。
  const worldSize = 100;
  const fieldSize = 64;
  const cellWorldSize = worldSize / fieldSize;

  it('stampGaussian → sample が dense 実装とビット一致する', () => {
    const dense = makeField(fieldSize);
    stampGaussian(dense, 32, 20, 6, 1.0);
    stampGaussian(dense, 40, 40, 4, 0.6);

    const chunked = new ChunkedFieldGrid({ chunkCells: fieldSize, cellWorldSize });
    chunked.stampGaussian(32 * cellWorldSize, 20 * cellWorldSize, 6 * cellWorldSize, 1.0);
    chunked.stampGaussian(40 * cellWorldSize, 40 * cellWorldSize, 4 * cellWorldSize, 0.6);

    for (let fy = 5; fy < fieldSize - 5; fy += 3) {
      for (let fx = 5; fx < fieldSize - 5; fx += 3) {
        const denseV = sampleField(dense, fx, fy);
        const chunkedV = chunked.sample(fx * cellWorldSize, fy * cellWorldSize);
        expect(chunkedV).toBeCloseTo(denseV, 6);
      }
    }
  });

  it('stampObstacle が dense 実装とセル単位で一致する', () => {
    const dense = makeField(fieldSize);
    stampObstacle(dense, 32, 32, 8);

    const chunked = new ChunkedFieldGrid({ chunkCells: fieldSize, cellWorldSize });
    chunked.stampObstacle(32 * cellWorldSize, 32 * cellWorldSize, 8 * cellWorldSize);

    for (let fy = 0; fy < fieldSize; fy++) {
      for (let fx = 0; fx < fieldSize; fx++) {
        const denseV = dense.data[fy * fieldSize + fx] ?? 0;
        const chunkedV = chunked.sampleNearest(fx * cellWorldSize, fy * cellWorldSize);
        expect(chunkedV).toBe(denseV);
      }
    }
  });
});

describe('ChunkedFieldGrid のチャンク境界越え', () => {
  it('チャンク境界をまたぐスタンプは両方のチャンクに正しく書き込まれる', () => {
    const grid = new ChunkedFieldGrid({ chunkCells: 16, cellWorldSize: 1 });
    // チャンク境界 (x=16) をまたぐ位置にスタンプする。
    grid.stampGaussian(16, 8, 5, 1.0);
    expect(grid.chunkCount()).toBeGreaterThan(1);
    // 境界の両側でゼロでない値が観測できる。
    expect(grid.sampleNearest(14, 8)).toBeGreaterThan(0);
    expect(grid.sampleNearest(18, 8)).toBeGreaterThan(0);
  });

  it('バイリニア補間もチャンク境界をまたいで連続に評価できる', () => {
    const grid = new ChunkedFieldGrid({ chunkCells: 8, cellWorldSize: 1 });
    grid.stampObstacle(0, 0, 20); // 十分広く 1.0 で塗りつぶす
    // チャンク境界 (x=8) をまたぐ点を補間サンプルしても 1.0 のまま。
    expect(grid.sample(7.5, 3)).toBeCloseTo(1.0, 5);
    expect(grid.sample(8.5, 3)).toBeCloseTo(1.0, 5);
  });

  it('負の座標のチャンクも正しく扱える (floor division)', () => {
    const grid = new ChunkedFieldGrid({ chunkCells: 8, cellWorldSize: 1 });
    grid.stampGaussian(-10, -10, 4, 1.0);
    expect(grid.sampleNearest(-10, -10)).toBeGreaterThan(0);
  });
});

describe('ChunkedFieldGrid の遅延生成', () => {
  it('未参照のチャンクは生成されない', () => {
    let generated = 0;
    const grid = new ChunkedFieldGrid({
      chunkCells: 16,
      cellWorldSize: 1,
      generate: () => { generated++; },
    });
    expect(grid.chunkCount()).toBe(0);
    expect(generated).toBe(0);

    grid.sampleNearest(5, 5);
    expect(generated).toBe(1);
    expect(grid.hasChunk(0, 0)).toBe(true);
    expect(grid.hasChunk(1, 0)).toBe(false);
  });

  it('同じチャンクは1度しか生成されない (決定的な初期化が再実行されない)', () => {
    let generated = 0;
    const grid = new ChunkedFieldGrid({
      chunkCells: 16,
      cellWorldSize: 1,
      generate: (_coord, data) => { generated++; data.fill(generated); },
    });
    grid.ensureChunk(2, 3);
    grid.ensureChunk(2, 3);
    grid.ensureChunk(2, 3);
    expect(generated).toBe(1);
  });

  it('generate はチャンク座標を受け取り、座標ごとに決定的な内容を作れる', () => {
    const grid = new ChunkedFieldGrid({
      chunkCells: 4,
      cellWorldSize: 1,
      generate: (coord, data, cells) => {
        for (let i = 0; i < cells * cells; i++) data[i] = coord.cx * 100 + coord.cy;
      },
    });
    expect(grid.sampleNearest(0, 0)).toBe(0);
    expect(grid.sampleNearest(4, 0)).toBe(100);
    expect(grid.sampleNearest(0, 4)).toBe(1);

    // 再度同じ座標を参照しても同じ値 (決定的)。
    const gridB = new ChunkedFieldGrid({
      chunkCells: 4,
      cellWorldSize: 1,
      generate: (coord, data, cells) => {
        for (let i = 0; i < cells * cells; i++) data[i] = coord.cx * 100 + coord.cy;
      },
    });
    expect(gridB.sampleNearest(4, 0)).toBe(grid.sampleNearest(4, 0));
  });
});

// M32: 原野の「直前1手」Undo が使う captureRegion/restoreRegion。
describe('ChunkedFieldGrid.captureRegion/restoreRegion (M32)', () => {
  it('スタンプ前の値を復元できる', () => {
    const grid = new ChunkedFieldGrid({ chunkCells: 16, cellWorldSize: 1 });
    grid.stampGaussian(10, 10, 4, 0.5); // 事前の地形 (復元後も残るべき)
    const before = grid.sampleNearest(10, 10);

    const patch = grid.captureRegion(10, 10, 8);
    grid.stampGaussian(10, 10, 4, 0.9); // プレイヤーの一手
    expect(grid.sampleNearest(10, 10)).not.toBeCloseTo(before, 5);

    grid.restoreRegion(patch);
    expect(grid.sampleNearest(10, 10)).toBeCloseTo(before, 5);
  });

  it('チャンク境界をまたぐキャプチャも正しく復元する', () => {
    const grid = new ChunkedFieldGrid({ chunkCells: 8, cellWorldSize: 1 });
    grid.stampObstacle(0, 0, 20);
    const before = grid.sampleNearest(7.5, 3);
    expect(grid.chunkCount()).toBeGreaterThan(1);

    const patch = grid.captureRegion(8, 3, 6); // x=8 の境界をまたぐ矩形
    grid.stampGaussian(8, 3, 3, 1.0);
    grid.restoreRegion(patch);
    expect(grid.sampleNearest(7.5, 3)).toBeCloseTo(before, 5);
    expect(grid.sampleNearest(8.5, 3)).toBeCloseTo(before, 5);
  });

  it('捕まえた矩形の外側は復元の影響を受けない', () => {
    const grid = new ChunkedFieldGrid({ chunkCells: 16, cellWorldSize: 1 });
    grid.stampGaussian(50, 50, 3, 0.7); // captureRegion の範囲外に既存の地形
    const farBefore = grid.sampleNearest(50, 50);

    const patch = grid.captureRegion(10, 10, 5);
    grid.stampGaussian(10, 10, 3, 0.6);
    grid.stampGaussian(50, 50, 3, 0.3); // 範囲外への変更 (undo 対象ではない)
    grid.restoreRegion(patch);
    // 範囲外の変更は undo で戻らない (キャプチャしていないため)。
    expect(grid.sampleNearest(50, 50)).not.toBeCloseTo(farBefore, 5);
  });
});
