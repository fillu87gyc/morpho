import { describe, it, expect } from 'vitest';
import { scatterDecorations } from '../src/ecology-scatter.js';

function uniformField(size: number, value: number): Float32Array {
  return new Float32Array(size * size).fill(value);
}

describe('scatterDecorations', () => {
  it('同じ入力なら常に同じ配置を返す (決定性)', () => {
    const size = 40;
    const moisture = uniformField(size, 0.4);
    const obstacle = uniformField(size, 0);
    const water = uniformField(size, 0);
    const a = scatterDecorations(moisture, obstacle, water, size, 100);
    const b = scatterDecorations(moisture, obstacle, water, size, 100);
    expect(a).toEqual(b);
  });

  it('全面が水なら何も配置しない', () => {
    const size = 20;
    const moisture = uniformField(size, 0.4);
    const obstacle = uniformField(size, 0);
    const water = uniformField(size, 1);
    expect(scatterDecorations(moisture, obstacle, water, size, 100)).toEqual([]);
  });

  it('全面が障害物なら何も配置しない', () => {
    const size = 20;
    const moisture = uniformField(size, 0.4);
    const obstacle = uniformField(size, 1);
    const water = uniformField(size, 0);
    expect(scatterDecorations(moisture, obstacle, water, size, 100)).toEqual([]);
  });

  it('湿った開けた土地ではキノコが一定数出る', () => {
    const size = 60;
    const moisture = uniformField(size, 0.6);
    const obstacle = uniformField(size, 0);
    const water = uniformField(size, 0);
    const placements = scatterDecorations(moisture, obstacle, water, size, 100);
    const mushrooms = placements.filter((p) => p.kind === 'mushroom');
    expect(mushrooms.length).toBeGreaterThan(0);
  });

  it('乾いた土地ではキノコが出ない', () => {
    const size = 60;
    const moisture = uniformField(size, 0.1);
    const obstacle = uniformField(size, 0);
    const water = uniformField(size, 0);
    const placements = scatterDecorations(moisture, obstacle, water, size, 100);
    expect(placements.filter((p) => p.kind === 'mushroom')).toEqual([]);
  });

  it('岩塊の際には苔が集中する', () => {
    const size = 60;
    const moisture = uniformField(size, 0.1); // キノコが出ない条件にしておく
    const obstacle = new Float32Array(size * size);
    // 中央に岩の塊を置く
    for (let y = 25; y < 35; y++) {
      for (let x = 25; x < 35; x++) obstacle[y * size + x] = 1;
    }
    const water = uniformField(size, 0);
    const placements = scatterDecorations(moisture, obstacle, water, size, 100);
    const moss = placements.filter((p) => p.kind === 'moss-clump');
    expect(moss.length).toBeGreaterThan(0);
    // 全てのバリエーション番号が1..3の範囲内
    for (const p of moss) {
      expect(p.variant).toBeGreaterThanOrEqual(1);
      expect(p.variant).toBeLessThanOrEqual(3);
    }
  });

  it('配置は常にワールド座標の範囲内に収まる', () => {
    const size = 50;
    const moisture = uniformField(size, 0.5);
    const obstacle = uniformField(size, 0);
    const water = uniformField(size, 0);
    const worldSize = 80;
    const placements = scatterDecorations(moisture, obstacle, water, size, worldSize);
    for (const p of placements) {
      expect(p.pos.x).toBeGreaterThanOrEqual(0);
      expect(p.pos.x).toBeLessThanOrEqual(worldSize);
      expect(p.pos.y).toBeGreaterThanOrEqual(0);
      expect(p.pos.y).toBeLessThanOrEqual(worldSize);
    }
  });
});
