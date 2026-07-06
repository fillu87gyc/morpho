import { describe, it, expect } from 'vitest';
import { extractCoastline } from '../src/coastline.js';

function grid(size: number, fill: (x: number, y: number) => number): Float32Array {
  const f = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) f[y * size + x] = fill(x, y);
  }
  return f;
}

describe('extractCoastline', () => {
  it('全て陸地 (水なし) なら輪郭を返さない', () => {
    const f = grid(6, () => 0);
    expect(extractCoastline(f, 6, 60).loops).toEqual([]);
  });

  it('全て水 (陸なし) なら輪郭を返さない (境界を跨がない)', () => {
    const f = grid(6, () => 1);
    expect(extractCoastline(f, 6, 60).loops).toEqual([]);
  });

  it('矩形の水たまりは1つの閉じた輪郭になる', () => {
    // 8x8 グリッドの中央 2x2 (index 3,4) が水域。
    const f = grid(8, (x, y) => (x >= 3 && x <= 4 && y >= 3 && y <= 4 ? 1 : 0));
    const { loops } = extractCoastline(f, 8, 80);
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    expect(loop.length).toBeGreaterThanOrEqual(4);
    // 輪郭は中央付近 (ワールド座標で 30〜50 あたり) に収まる。
    for (const p of loop) {
      expect(p.x).toBeGreaterThan(20);
      expect(p.x).toBeLessThan(60);
      expect(p.y).toBeGreaterThan(20);
      expect(p.y).toBeLessThan(60);
    }
  });

  it('離れた2つの水たまりは2つの輪郭になる', () => {
    const f = grid(12, (x, y) => {
      const inA = x >= 1 && x <= 2 && y >= 1 && y <= 2;
      const inB = x >= 8 && x <= 9 && y >= 8 && y <= 9;
      return inA || inB ? 1 : 0;
    });
    const { loops } = extractCoastline(f, 12, 120);
    expect(loops).toHaveLength(2);
  });

  it('しきい値を変えると輪郭の位置が変わる (深いほど内側)', () => {
    // 中心が高い値、外側が低い値のなだらかな山。
    const f = grid(20, (x, y) => {
      const dx = x - 10, dy = y - 10;
      const d = Math.sqrt(dx * dx + dy * dy);
      return Math.max(0, 1 - d / 8);
    });
    const shallow = extractCoastline(f, 20, 100, 0.2).loops[0]!;
    const deep = extractCoastline(f, 20, 100, 0.7).loops[0]!;
    const avgRadius = (loop: { x: number; y: number }[]) => {
      const cx = loop.reduce((a, p) => a + p.x, 0) / loop.length;
      const cy = loop.reduce((a, p) => a + p.y, 0) / loop.length;
      return loop.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / loop.length;
    };
    expect(avgRadius(deep)).toBeLessThan(avgRadius(shallow));
  });

  it('極小の水たまりは minLoopPoints 未満として除外できる', () => {
    const f = grid(10, (x, y) => (x === 5 && y === 5 ? 1 : 0));
    const { loops } = extractCoastline(f, 10, 100, 0.5, 100);
    expect(loops).toEqual([]);
  });
});
