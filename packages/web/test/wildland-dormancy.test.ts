// M29-B: 原野への休眠配線のテスト。
//   - 原野の paramOverrides で休眠 + evict が実際に動くこと
//   - 「探索チャンク」が evict で減らない累計 (touched) であること
//   - プレイヤーツールが休眠領域を起こすこと (起床経路その3)
//   - 有界6ステージでは休眠が一切動かないこと (カウンタ 0)

import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

// dormancy.ts の packDormancyCell の逆変換 (テスト用)。
const CELL_STRIDE = 1 << 20;
const CELL_OFFSET = 1 << 19;
function unpackCell(k: number): { cx: number; cy: number } {
  const cy = (k % CELL_STRIDE) - CELL_OFFSET;
  const cx = Math.floor(k / CELL_STRIDE) - CELL_OFFSET;
  return { cx, cy };
}

// 前線が母体から離れて休眠セルが生まれるまで回す (seed 1234 の実測では
// Day 4 で 19 セル。ここでは最初の1セルが出た時点で止める)。
function tickUntilDormant(g: Game, maxTicks = 1500): void {
  for (let t = 0; t < maxTicks; t += 60) {
    g.tick(60);
    if ((g.dormancyCounters().dormantCells ?? 0) > 0) return;
  }
}

describe('原野の休眠配線 (M29-B)', () => {
  it('原野では休眠セルと evict 済みチャンクが実際に生まれる', () => {
    const g = new Game(1234, 'wildland');
    // M31: 極小スタート (発芽ラッチ) で序盤の成長が控えめになったぶん、
    // 休眠/evict が育つまでの猶予を Day 5→7.5 相当へ延ばす (実測: seed 1234
    // で tick 1800 は dormantCells 19 / evictedChunks 4 と十分に余裕がある —
    // tick 1200 は evictedChunks は非ゼロだが dormantCells が一時的に 0 へ
    // 落ち込む瞬間に当たりフレークしていた)。
    g.tick(1800);
    const c = g.dormancyCounters();
    expect(c.dormantCells).toBeGreaterThan(0);
    expect(c.evictedChunks).toBeGreaterThan(0);
  }, 30_000);

  it('「探索チャンク」は evict されても減らない累計 (touched) を数える', () => {
    const g = new Game(1234, 'wildland');
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      g.tick(120);
      const w = g.snapshot().world;
      expect(w.exploredChunks).toBeGreaterThanOrEqual(prev);
      prev = w.exploredChunks;
    }
    // evict が起きたあとでも累計は初期値より増えている。
    expect(g.dormancyCounters().evictedChunks).toBeGreaterThan(0);
    expect(prev).toBeGreaterThan(1);
  }, 30_000);

  it('ツール適用は休眠セルを起こす (起床経路その3)', () => {
    const g = new Game(1234, 'wildland');
    tickUntilDormant(g);
    const before = g.state.dormantCells!;
    expect(before.size).toBeGreaterThan(0);
    // 休眠セルの1つを選び、その中心へ餌を撒く。apply はローカル座標
    // (窓相対) を取るので、実座標から windowOrigin を引いて渡す。
    const key = [...before][0]!;
    const { cx, cy } = unpackCell(key);
    const cellWorld = 24; // stages.ts の dormancyCellWorld
    const real = { x: cx * cellWorld + cellWorld / 2, y: cy * cellWorld + cellWorld / 2 };
    const origin = g.snapshotFast().windowOrigin!;
    g.setTool('food');
    g.apply({ x: real.x - origin.x, y: real.y - origin.y });
    expect(g.state.dormantCells!.has(key)).toBe(false);
  }, 30_000);

  it('有界ステージでは休眠カウンタは常に 0 (既存挙動は不変)', () => {
    const g = new Game(1234, 'petri');
    g.tick(300);
    const c = g.dormancyCounters();
    expect(c.dormantCells).toBe(0);
    expect(c.evictedChunks).toBe(0);
    expect(g.state.dormantCells).toBeUndefined();
  }, 30_000);
});
