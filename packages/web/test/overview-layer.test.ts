// M28-B: 大局レイヤー/ワールドマップのチャンク色 (純粋関数) のテスト。
// OverviewTileCache (オフスクリーン canvas) は DOM 依存なのでここでは触らず、
// 色の決定則だけを守る。

import { describe, it, expect } from 'vitest';
import { chunkTileColor, biomassGlowAlpha, OVERVIEW_VOID_COLOR } from '../src/overview-layer.js';
import type { WorldChunkSummary } from '../src/world-overview.js';

function chunk(over: Partial<WorldChunkSummary> = {}): WorldChunkSummary {
  return { cx: 0, cy: 0, nutrientAvg: 0, obstacleDensity: 0, hasWater: false, toxinAvg: 0, biomass: 0, ...over };
}

describe('chunkTileColor (M28-B)', () => {
  it('栄養が多いほど地面が明るい (明度の単調性)', () => {
    const poor = chunkTileColor(chunk({ nutrientAvg: 0 }));
    const mid = chunkTileColor(chunk({ nutrientAvg: 0.01 }));
    const rich = chunkTileColor(chunk({ nutrientAvg: 0.05 }));
    const lum = ([r, g, b]: [number, number, number]) => r + g + b;
    expect(lum(mid)).toBeGreaterThan(lum(poor));
    expect(lum(rich)).toBeGreaterThan(lum(mid));
    // 訪問済みの最貧チャンクでも未訪問の暗さよりは明るい (見分けがつく)。
    expect(lum(poor)).toBeGreaterThan(OVERVIEW_VOID_COLOR[0] + OVERVIEW_VOID_COLOR[1] + OVERVIEW_VOID_COLOR[2]);
  });

  it('水域チャンクは青が勝つ (b > r)', () => {
    const [r, , b] = chunkTileColor(chunk({ hasWater: true }));
    expect(b).toBeGreaterThan(r);
  });

  it('岩がちなチャンクは無彩色 (岩色) に寄る', () => {
    const plain = chunkTileColor(chunk({ nutrientAvg: 0.02 }));
    const rocky = chunkTileColor(chunk({ nutrientAvg: 0.02, obstacleDensity: 0.1 }));
    // 岩色は R が強い (緑の地面より赤みがある) — 岩で赤成分が増える。
    expect(rocky[0]).toBeGreaterThan(plain[0]);
  });

  it('M30: 毒の窪地 (toxinAvg が高い) は紫に寄る (R が増え、G より B が強まる)', () => {
    const plain = chunkTileColor(chunk({ nutrientAvg: 0.02 }));
    const toxic = chunkTileColor(chunk({ nutrientAvg: 0.02, toxinAvg: 0.03 }));
    expect(toxic[0]).toBeGreaterThan(plain[0]); // 紫の赤み
    expect(toxic[2]).toBeGreaterThan(plain[2]); // 紫の青み
    // 苔の緑 (plain は G 優勢) と見分けがつく: 毒地では B が G に迫る/超える。
    expect(toxic[2] - toxic[1]).toBeGreaterThan(plain[2] - plain[1]);
  });

  it('値は常に 0..255 の整数', () => {
    for (const c of [chunk(), chunk({ nutrientAvg: 99, obstacleDensity: 99, hasWater: true })]) {
      for (const v of chunkTileColor(c)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('biomassGlowAlpha (M28-B)', () => {
  it('0 以下では光らない', () => {
    expect(biomassGlowAlpha(0)).toBe(0);
    expect(biomassGlowAlpha(-5)).toBe(0);
  });

  it('量に対して単調増加し、1 に飽和する (白飛びしない)', () => {
    const a = biomassGlowAlpha(10);
    const b = biomassGlowAlpha(100);
    const c = biomassGlowAlpha(10_000);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(1);
  });
});
