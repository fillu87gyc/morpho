// M32: 原野の「直前1手」Undo (Game 経由)。
//   - ツール1回ぶんの変更を undoStroke() で取り消せる
//   - 直前の1手だけが対象 (2手前は戻らない)
//   - erase は原野ではスコープ外 (M25 からの既存挙動、変わらない)
//   - 有界6ステージの Undo (stroke ベース、深さ10) は完全に不変

import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

// 窓ローカル座標 → 表示用密フィールドの生値 (game.test.ts の obstacleAt と同型)。
function fieldAt(g: Game, field: { data: Float32Array }, pos: { x: number; y: number }): number {
  const fs = g.fieldSize;
  const s = fs / g.worldSize;
  const x = Math.min(fs - 1, Math.max(0, Math.floor(pos.x * s)));
  const y = Math.min(fs - 1, Math.max(0, Math.floor(pos.y * s)));
  return field.data[y * fs + x] ?? 0;
}

describe('原野の「直前1手」Undo (M32)', () => {
  it('ツール適用直後は canUndo が true になり、undoStroke() で元の値に戻る', () => {
    const g = new Game(1234, 'wildland');
    const pos = { x: 55, y: 55 };
    expect(g.canUndo).toBe(false);

    g.setTool('food');
    g.setBrush(5);
    const before = fieldAt(g, g.env.nutrients, pos);
    g.apply(pos);
    g.tick(1); // 窓の焼き直しで表示用フィールドへ反映
    expect(fieldAt(g, g.env.nutrients, pos)).toBeGreaterThan(before);
    expect(g.canUndo).toBe(true);

    // undoStroke() は内部で rebakeWildlandWindow() を呼び、窓へ即座に反映する
    // (もう一度 tick() すると自然減衰が1回ぶん進み、before との比較がその分
    // ずれてしまうため、ここでは tick() を挟まない)。
    g.undoStroke();
    expect(fieldAt(g, g.env.nutrients, pos)).toBeCloseTo(before, 4);
    expect(g.canUndo).toBe(false);
  });

  it('直前の1手だけが対象 — 2手前の変更は undo で戻らない', () => {
    const g = new Game(1234, 'wildland');
    const posA = { x: 40, y: 40 };
    const posB = { x: 70, y: 70 };
    g.setTool('stone');
    g.setBrush(4);
    g.apply(posA); // 1手目
    g.tick(1);
    const afterA = fieldAt(g, g.env.obstacle, posA);
    expect(afterA).toBeGreaterThan(0);

    g.apply(posB); // 2手目 (直前の手として上書き)
    g.tick(1);
    expect(fieldAt(g, g.env.obstacle, posB)).toBeGreaterThan(0);

    g.undoStroke(); // 2手目だけが戻る
    g.tick(1);
    expect(fieldAt(g, g.env.obstacle, posB)).toBe(0);
    // 1手目 (posA) は「直前1手」の範囲外なので undo の影響を受けない。
    expect(fieldAt(g, g.env.obstacle, posA)).toBe(afterA);

    // 2手目はもう undo 済みなので、もう一度呼んでも何も起きない (安全)。
    expect(g.canUndo).toBe(false);
    expect(() => g.undoStroke()).not.toThrow();
  });

  it('erase ツールは原野ではスコープ外 (M25 からの既存挙動、undo 対象にもならない)', () => {
    const g = new Game(1234, 'wildland');
    g.setTool('food');
    g.setBrush(5);
    g.apply({ x: 50, y: 50 });
    expect(g.canUndo).toBe(true);

    g.setTool('erase');
    g.apply({ x: 50, y: 50 }); // no-op
    // erase は何も記録しないので、直前の 'food' の Undo 対象がそのまま残る。
    expect(g.canUndo).toBe(true);
  });

  it('チャンク境界をまたぐ配置も正しく復元できる', () => {
    const g = new Game(7, 'wildland');
    // WILDLAND_CHUNK_CELLS=48 の境界近くのローカル座標を狙う。
    const pos = { x: 48, y: 50 };
    g.setTool('water');
    g.setBrush(8);
    const before = fieldAt(g, g.env.moisture, pos);
    g.apply(pos);
    g.tick(1);
    expect(fieldAt(g, g.env.moisture, pos)).toBeGreaterThan(before);
    g.undoStroke();
    expect(fieldAt(g, g.env.moisture, pos)).toBeCloseTo(before, 3);
  });

  it('有界6ステージの Undo (stroke ベース) は完全に不変', () => {
    const g = new Game(5, 'petri');
    const pos = { x: 60, y: 60 };
    g.setTool('stone');
    g.setBrush(5);
    g.beginStroke();
    g.apply(pos);
    g.endStroke();
    expect(fieldAt(g, g.env.obstacle, pos)).toBeGreaterThan(0);
    expect(g.canUndo).toBe(true);

    g.undoStroke();
    expect(fieldAt(g, g.env.obstacle, pos)).toBe(0);
    expect(g.canUndo).toBe(false);
  });
});
