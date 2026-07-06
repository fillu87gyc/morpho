import { describe, it, expect } from 'vitest';
import { extractTerrainBlobs } from '../src/terrain-blobs.js';

function grid(size: number, cells: [number, number][], value = 1): Float32Array {
  const f = new Float32Array(size * size);
  for (const [x, y] of cells) f[y * size + x] = value;
  return f;
}

describe('extractTerrainBlobs', () => {
  it('全て空なら何も返さない', () => {
    const f = grid(4, []);
    expect(extractTerrainBlobs(f, 4, 100)).toEqual([]);
  });

  it('単一セルは1つの小さいブロブになる', () => {
    const f = grid(4, [[1, 1]]);
    const blobs = extractTerrainBlobs(f, 4, 100);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.cellCount).toBe(1);
    // fieldSize=4, worldSize=100 → cellWorld=25。セル(1,1)の中心は (1.5*25, 1.5*25)。
    expect(blobs[0]!.cx).toBeCloseTo(37.5);
    expect(blobs[0]!.cy).toBeCloseTo(37.5);
  });

  it('隣接する2x2セルは1つのブロブに統合される', () => {
    const f = grid(4, [[0, 0], [1, 0], [0, 1], [1, 1]]);
    const blobs = extractTerrainBlobs(f, 4, 100);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.cellCount).toBe(4);
  });

  it('離れたセルは別々のブロブになる (対角だけの接触は非連結)', () => {
    const f = grid(4, [[0, 0], [3, 3]]);
    const blobs = extractTerrainBlobs(f, 4, 100);
    expect(blobs).toHaveLength(2);
  });

  it('しきい値以下のセルは無視する', () => {
    const f = grid(4, [[1, 1]], 0.3);
    expect(extractTerrainBlobs(f, 4, 100, 0.5)).toEqual([]);
  });

  it('走査順 (行優先) で決定的に返る', () => {
    const f = grid(4, [[3, 0], [0, 3]]);
    const blobs = extractTerrainBlobs(f, 4, 100);
    expect(blobs).toHaveLength(2);
    // (3,0) の方が走査順で先に見つかる
    expect(blobs[0]!.cx).toBeGreaterThan(blobs[1]!.cx);
  });

  it('大きいブロブほど radiusWorld が大きい', () => {
    const small = extractTerrainBlobs(grid(6, [[0, 0]]), 6, 60)[0]!;
    const big = extractTerrainBlobs(
      grid(6, [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [2, 1]]),
      6, 60,
    )[0]!;
    expect(big.radiusWorld).toBeGreaterThan(small.radiusWorld);
  });
});
