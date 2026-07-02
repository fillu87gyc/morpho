import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

// env.obstacle は FieldGrid (プレーンな Float32Array) で、BiomassField 等の
// ScalarField と違い .sample() を持たない。ワールド座標→最寄りセルの
// 生値を直接読む。
function obstacleAt(g: Game, pos: { x: number; y: number }): number {
  const fs = g.fieldSize;
  const s = fs / g.worldSize;
  const x = Math.min(fs - 1, Math.max(0, Math.floor(pos.x * s)));
  const y = Math.min(fs - 1, Math.max(0, Math.floor(pos.y * s)));
  return g.env.obstacle.data[y * fs + x] ?? 0;
}

describe('Game', () => {
  it('同じseedなら同じtick数だけ進めたときに同じ状態になる', () => {
    const a = new Game(42);
    const b = new Game(42);
    a.setSpeed(1);
    b.setSpeed(1);
    for (let i = 0; i < 60; i++) { a.tick(); b.tick(); }

    const sa = a.snapshot();
    const sb = b.snapshot();
    expect(sa.state.nodes.length).toBe(sb.state.nodes.length);
    expect(sa.state.edges.length).toBe(sb.state.edges.length);
    for (let i = 0; i < sa.state.nodes.length; i++) {
      expect(sa.state.nodes[i]!.pos.x).toBe(sb.state.nodes[i]!.pos.x);
      expect(sa.state.nodes[i]!.pos.y).toBe(sb.state.nodes[i]!.pos.y);
    }
  });

  it('異なるseedなら結果が分岐する', () => {
    const a = new Game(1);
    const b = new Game(2);
    a.setSpeed(1);
    b.setSpeed(1);
    for (let i = 0; i < 60; i++) { a.tick(); b.tick(); }

    const sa = a.snapshot();
    const sb = b.snapshot();
    const same = sa.state.nodes.length === sb.state.nodes.length
      && sa.state.edges.length === sb.state.edges.length;
    expect(same).toBe(false);
  });

  it('reset は同じ seed を渡せば同じ初期状態を再現する', () => {
    const g = new Game(7);
    g.setSpeed(1);
    for (let i = 0; i < 20; i++) g.tick();
    g.reset(7);
    const afterFirstReset = g.snapshot();

    g.reset(7);
    const afterSecondReset = g.snapshot();

    expect(afterFirstReset.state.nodes.length).toBe(afterSecondReset.state.nodes.length);
    expect(afterFirstReset.day).toBe(0);
    expect(afterFirstReset.world.coloniesTotal).toBe(6);
  });

  it('speed=0 だと tick() を呼んでも sim tick が進まない', () => {
    const g = new Game(3);
    g.setSpeed(0);
    const before = g.snapshot().state.tick;
    for (let i = 0; i < 10; i++) g.tick();
    expect(g.snapshot().state.tick).toBe(before);
  });

  it('day は state.tick / 40 切り捨て、日数が進むにつれ era 名が変わる', () => {
    const g = new Game(11);
    g.setSpeed(1);
    const eras = new Set<string>();
    for (let i = 0; i < 400; i++) {
      g.tick();
      eras.add(g.snapshot().era);
    }
    expect(g.snapshot().day).toBe(10);
    expect(g.snapshot().era).toBe('拡散期');
    // 胞子期 (day<10) は少なくとも一度は観測されているはず。
    expect(eras.has('胞子期')).toBe(true);
  });

  it('food ツールを適用すると拠点総数が増え、イベントログに記録される', () => {
    const g = new Game(5);
    g.setTool('food');
    g.setBrush(4);
    const before = g.snapshot().world.coloniesTotal;
    g.apply({ x: 10, y: 10 });
    const after = g.snapshot();
    expect(after.world.coloniesTotal).toBe(before + 1);
    expect(g.events()[0]).toContain('栄養を撒いた');
  });

  it('stone ツールを適用すると障害物フィールドに値が乗る', () => {
    const g = new Game(5);
    g.setTool('stone');
    g.setBrush(5);
    const pos = { x: 60, y: 60 };
    g.apply(pos);
    expect(obstacleAt(g, pos)).toBeGreaterThan(0);
  });

  it('erase ツールは配置済みの地形をゼロに戻す', () => {
    const g = new Game(5);
    g.setTool('stone');
    g.setBrush(5);
    const pos = { x: 60, y: 60 };
    g.apply(pos);
    expect(obstacleAt(g, pos)).toBeGreaterThan(0);

    g.setTool('erase');
    g.setBrush(6);
    g.apply(pos);
    expect(obstacleAt(g, pos)).toBe(0);
  });

  it('snapshot の balance / traits は常に [0,1] の範囲に収まる', () => {
    const g = new Game(21);
    g.setSpeed(1);
    for (let i = 0; i < 100; i++) g.tick();
    const s = g.snapshot();
    for (const v of Object.values(s.balance)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(s.traits.exploration).toBeGreaterThanOrEqual(0);
    expect(s.traits.exploration).toBeLessThanOrEqual(1);
    expect(s.questProgress).toBeGreaterThanOrEqual(0);
    expect(s.questProgress).toBeLessThanOrEqual(1);
  });
});
