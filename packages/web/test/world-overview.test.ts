// M28: world-overview.ts (到達距離の純粋関数 + 俯瞰の最新値の置き場) のテスト。

import { describe, it, expect } from 'vitest';
import {
  computeReachDistance, setWorldOverview, getWorldOverview, overviewLocalBBox,
  type WorldOverview, type WorldChunkSummary,
} from '../src/world-overview.js';

describe('computeReachDistance (M28)', () => {
  it('点がなければ 0', () => {
    expect(computeReachDistance([], { x: 5, y: 5 })).toBe(0);
  });

  it('母体から最遠の点までの距離を返す', () => {
    const origin = { x: 0, y: 0 };
    const points = [
      { x: 3, y: 4 },   // 距離 5
      { x: -6, y: 8 },  // 距離 10 (最遠)
      { x: 1, y: 1 },
    ];
    expect(computeReachDistance(points, origin)).toBe(10);
  });

  it('母体そのものしか無ければ 0 (負にはならない)', () => {
    expect(computeReachDistance([{ x: 7, y: -3 }], { x: 7, y: -3 })).toBe(0);
  });

  it('原点が母体でなくても平行移動に不変', () => {
    const points = [{ x: 13, y: 14 }, { x: 4, y: 8 }];
    const shifted = points.map((p) => ({ x: p.x + 100, y: p.y + 100 }));
    expect(computeReachDistance(shifted, { x: 100, y: 100 }))
      .toBeCloseTo(computeReachDistance(points, { x: 0, y: 0 }), 10);
  });
});

// M28-B: 訪問済みチャンク集合 → 窓ローカル座標の bbox (カメラの動的最小
// ズームとパン範囲の材料)。
describe('overviewLocalBBox (M28-B)', () => {
  function chunk(cx: number, cy: number): WorldChunkSummary {
    return { cx, cy, nutrientAvg: 0, obstacleDensity: 0, hasWater: false, toxinAvg: 0, biomass: 0 };
  }

  it('チャンクが無ければ null', () => {
    expect(overviewLocalBBox([], 48, { x: 0, y: 0 })).toBeNull();
  });

  it('1チャンクなら「そのチャンクの領域 − 窓原点」', () => {
    // チャンク (10, 20)、一辺 48 → 実座標 [480, 528) × [960, 1008)。
    // 窓原点 (400, 900) を引いた窓ローカル座標になる。
    expect(overviewLocalBBox([chunk(10, 20)], 48, { x: 400, y: 900 })).toEqual({
      minX: 80, minY: 60, maxX: 128, maxY: 108,
    });
  });

  it('複数チャンクは番地の min/max を覆う (maxCx+1 まで = チャンクの右下端を含む)', () => {
    const b = overviewLocalBBox([chunk(0, 0), chunk(3, 1), chunk(-2, 2)], 48, { x: 0, y: 0 })!;
    expect(b.minX).toBe(-2 * 48);
    expect(b.maxX).toBe(4 * 48);
    expect(b.minY).toBe(0);
    expect(b.maxY).toBe(3 * 48);
  });

  it('窓原点の平行移動にそのまま追従する (窓の再センタリングでずれない)', () => {
    const a = overviewLocalBBox([chunk(5, 5)], 48, { x: 0, y: 0 })!;
    const b = overviewLocalBBox([chunk(5, 5)], 48, { x: 30, y: -10 })!;
    expect(b.minX).toBe(a.minX - 30);
    expect(b.minY).toBe(a.minY + 10);
  });
});

describe('worldOverview の最新値の置き場 (M28)', () => {
  it('set したものが get で返り、null で消せる', () => {
    const overview: WorldOverview = {
      chunks: [{ cx: 0, cy: 0, nutrientAvg: 0.1, obstacleDensity: 0, hasWater: false, toxinAvg: 0, biomass: 1.5 }],
      windowOrigin: { x: 100, y: 200 },
      chunkWorldSize: 48,
      stats: { areaM2: 12, massKg: 0.05, exploredChunks: 3, reachDistance: 42 },
      tick: 10,
    };
    setWorldOverview(overview);
    expect(getWorldOverview()).toBe(overview);
    setWorldOverview(null);
    expect(getWorldOverview()).toBeNull();
  });
});
