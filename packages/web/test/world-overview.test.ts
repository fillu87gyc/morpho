// M28: world-overview.ts (到達距離の純粋関数 + 俯瞰の最新値の置き場) のテスト。

import { describe, it, expect } from 'vitest';
import { computeReachDistance, setWorldOverview, getWorldOverview, type WorldOverview } from '../src/world-overview.js';

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

describe('worldOverview の最新値の置き場 (M28)', () => {
  it('set したものが get で返り、null で消せる', () => {
    const overview: WorldOverview = {
      chunks: [{ cx: 0, cy: 0, nutrientAvg: 0.1, obstacleDensity: 0, hasWater: false, biomass: 1.5 }],
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
